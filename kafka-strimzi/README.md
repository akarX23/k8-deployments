
# Kafka on K8s using Strimzi

Kafka can be deployed on a production level using an operator developed by CNCF called Strimzi. You can get more detailed information about Strimzi on their [GitHub](https://github.com/strimzi/strimzi-kafka-operator) and their [website](https://strimzi.io/).

This guide's main focus is to expose the fundamental components of the operator and their usage to explore different features of Strimzi from a basic cluster to a advanced level while also highlighting the options available to customize them.

We will be talking mainly about the following components that Strimzi offers:

- **Cluster Operator** - This is the first component to be deployed for the Kafka cluster. This is responsible for managing the state of kafka cluster.
- **Kafka Cluster**- This is a CRD provided by the cluster operator which enables us to use deploy a kafka cluster. This includes the broker nodes, zookeeper nodes, and the entity operator along with the other Strimzi components.
- **Entity Operator**- This is responsible for managing topics and users in Kafka.
- **Kafka MirrorMaker**- This additional component enables us to have two kafka clusters in sync. This can be used to keep backup of a kafka cluster.

More information about all Strimzi components can be found [here](https://strimzi.io/docs/operators/latest/overview.html#kafka-components_str).

## Installing Strimzi on a K8 Cluster

First step before we setup the Kafka Cluster is to install all the CRDs required for the different components to work. We also need to setup the cluster operator before setting up the cluster. This inital step can be done using a few methods as described [here](https://strimzi.io/docs/operators/latest/deploying.html#con-strimzi-installation-methods_str). We will describe **HELM** here since it is very user friendly.

- First install helm CLI:

```
# Download the helm script
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3

# Install helm
chmod 700 get_helm.sh
./get_helm.sh
```

- Next add the Strimzi Helm Chart repository:

```
helm repo add strimzi https://strimzi.io/charts/
helm repo update
```

- Now we will make a `custom-values.yaml` file which will contain the configuration of the chart. A full list of options can be found [here](https://github.com/strimzi/strimzi-kafka-operator/tree/main/helm-charts/helm3/strimzi-kafka-operator#configuration). These are the configurations we will use:

```
# No. of cluster operators
replicas: 2

#  The service account name to be used
serviceAccount: akarx-kafka-strimzi

#  Temporary directory size limit
tmpDirSizeLimit: 500Mi

logLevel: debug

# JAVA Options to optimize performance
extraEnvs:
 - name: JAVA_OPTS
   value: "-Xms2048m -Xmx2048m"

# Resource configuration for the cluster-operator
resources:
 limits:
   memory: 12Gi
   cpu: 8000m
 requests:
   memory: 8Gi
   cpu: 4000m

```

**NOTE:** When you specify `replicas` greater than 1, only one cluster operator will be active while the rest remain on stand by. If the active operator goes down, one of the other ones immediately become active. This is called leader election. Read more [here](https://strimzi.io/docs/operators/latest/deploying.html#assembly-using-multiple-cluster-operator-replicas-str).

- Install the chart

```
# This will install the chart in the namespace kafka
helm install --create-namespace --namespace kafka kafka-operator strimzi/strimzi-kafka-operator -f custom-value.yaml

# See status of deployment
kubectl get all -n kafka
```

## Deploying Kafka Cluster

A Kafka Cluster is deployed using the `Kafka` CRD provided by the Strimzi operator. This CRD has a long list of very customizable options for specific use-cases. We can set options for almost all of Strimzi's components like Kafka, Zookeeper, Kafka MirrorMaker, KafkaConnect, etc. The entire list of options can be found [here](https://strimzi.io/docs/operators/latest/configuring.html#type-Kafka-reference).

This list can be overwhelming so we will go through some important options that we might have to look at for almost any type of configuration. Let's start with a basic deployment of a cluster:

```
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: akarx-cluster
  namespace: kafka
spec:
  kafka:
    version: 3.4.0
    replicas: 2
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
      - name: tls
        port: 9093
        type: internal
        tls: true
    config:
      offsets.topic.replication.factor: 1
      transaction.state.log.replication.factor: 1
      transaction.state.log.min.isr: 1
      default.replication.factor: 1
      min.insync.replicas: 1
      inter.broker.protocol.version: "3.4"
    storage:
      type: ephemeral
  zookeeper:
    replicas: 3
    storage:
      type: ephemeral
  entityOperator:
    topicOperator: {}
    userOperator: {}


```

In the above YAML the `kind` is `Kafka`. After the metadata we define configuration for each of the components that we intent to use in this Kafka CRD. Also, since while installing the cluster-operator through helm we didn't tell it watch any other namespace other than `kafka`, we have to specify here that we want to deploy this Kafka Cluster in the `kafka` namespace or else the operator won't be able to track it

First thing we define is the configuration of the main Kafka that handles the brokers. This is done using the `spec.kafka` property. A list of all options can be found [here](https://strimzi.io/docs/operators/latest/configuring.html#type-KafkaClusterSpec-reference). Not all values are required and the complexity really depends on the use-case. In our configuration we want 3 kafka brokers and we define 2 listeners so clients can internally and externally connect with the cluster. We have also defined storage option as `jbod` which basically says that multiple disks will be used. Here we have all storage as ephemeral but if we want to persist data we have to use the `type:persistent-claim`. More info on storage can be found [here](https://strimzi.io/docs/operators/latest/configuring.html#assembly-storage-str). Also storage type cannot be changed.

Next we define the zookeeper configuration. A full list of options can be found [here](https://strimzi.io/docs/operators/latest/configuring.html#type-ZookeeperClusterSpec-schema-reference). We will mainly use the `replicas` and the `storage` properties for a simple deployment.

**Note**: ZooKeeper clusters or ensembles usually run with an odd number of nodes, typically three, five, or seven. The majority of nodes must be available in order to maintain an effective quorum. If the ZooKeeper cluster loses its quorum, it will stop responding to clients and the Kafka brokers will stop working. Having a stable and highly available ZooKeeper cluster is crucial for Strimzi.

The Entity Operator consists the definition of the topic and user operator, but they are not required to be configured for a simple deployment so they are left as empty objects. However, if you decide to omit the `entityOperator` or the topic or user operator, they won't be deployed and your cluster won't react to the `KafkaTopic` custom CRDs.

To see the cluster that we created:

```
kubectl get -n kafka kafka

NAME            DESIRED KAFKA REPLICAS   DESIRED ZK REPLICAS   READY   WARNINGS
akarx-cluster   2                        3
```

And the pods:

```
kubectl get -n kafka pods -w
NAME                                        READY   STATUS             RESTARTS         AGE
akarx-cluster-kafka-0                       1/1     Running            0                3h23m
akarx-cluster-kafka-1                       1/1     Running            0                3h23m
akarx-cluster-zookeeper-0                   1/1     Running            0                3h24m
akarx-cluster-zookeeper-1                   1/1     Running            0                3h24m
akarx-cluster-zookeeper-2                   1/1     Running            0                3h24m
```

As you can see we have 2 kafka pods and 3 zookeeper pods.

The different services that were deployed can be viewed with `kubectl get svc -n kafka`

### Testing the cluster

We need to deploy a producer and a consumer to test the cluster. From the [strimz docs](https://strimzi.io/docs/operators/in-development/deploying.html#deploying-example-clients-str) here is how you can do it:

First create a producer

```
export CLUSTER_NAME=akarx-cluster
kubectl run kafka-producer -n kafka -ti --image=quay.io/strimzi/kafka:latest-kafka-3.4.0 --rm=true --restart=Never -- bin/kafka-console-producer.sh --bootstrap-server $CLUSTER_NAME-kafka-bootstrap:9092 --topic my-topic
```

Now once the cluster is running, type any thing in the console and press enter. You can do it multiple times to send multiple messages to Kafka.

Now create the consumer:

```
kubectl run kafka-consumer -n kafka -ti --image=quay.io/strimzi/kafka:latest-kafka-3.4.0 --rm=true --restart=Never -- bin/kafka-console-consumer.sh --bootstrap-server $CLUSTER_NAME-kafka-bootstrap:9092 --topic my-topic --from-beginning
```

This should print out the messages you typed in the producer!

### Adding an external listener

So far we added two listeners but both were for internal communication. Now let's add an external listener which will be of type `nodePort` and will alow us to test the cluster.
Make changes to the second listener of the previous yaml file:

```
...
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
      - name: external
        port: 9093
        type: nodeport
        tls: true
...
```

Notice we have added `tls: true`, we will take a look at TLS flow as well.
Now apply the new config `kubectl apply -f kafka-cluster.yaml`.

After some time you can see some `NodePort` service:

```
kubectl get svc -n kafka

NAME                                     TYPE        CLUSTER-IP      EXTERNAL-IP   PORT(S)                      AGE
akarx-cluster-kafka-bootstrap            ClusterIP   10.233.31.154   <none>        9091/TCP,9092/TCP            3h38m
akarx-cluster-kafka-brokers              ClusterIP   None            <none>        9090/TCP,9091/TCP,9092/TCP   3h38m
akarx-cluster-kafka-external-0           NodePort    10.233.31.206   <none>        9093:30405/TCP               51m
akarx-cluster-kafka-external-1           NodePort    10.233.59.109   <none>        9093:32031/TCP               51m
akarx-cluster-kafka-external-bootstrap   NodePort    10.233.9.32     <none>        9093:30398/TCP               51m
akarx-cluster-zookeeper-client           ClusterIP   10.233.5.151    <none>        2181/TCP                     3h39m
akarx-cluster-zookeeper-nodes            ClusterIP   None            <none>        2181/TCP,2888/TCP,3888/TCP   3h38m
```

As you can see we have 1 external `NodePort` for each replica. Also if you are hosting this K8 cluster in EKS, AKS or GKS, you can also use the `type: loadbalancer` option in the listener config. This will assign an external IP to your service.

### TLS configuration

Strimzi auto generates the TLS certificates and Keys and stores them as secret. These need to be used to communicate with the cluster over TLS. You can use your own cetificates as well, refer [here](https://strimzi.io/docs/operators/latest/configuring.html#con-common-configuration-trusted-certificates-referencer).

```
# Extract the CA Certificates  and password
export CLUSTER_NAME=akarx-cluster
kubectl get secret -n kafka $CLUSTER_NAME-cluster-ca-cert -o jsonpath='{.data.ca\.password}' | base64 --decode > ca.password
kubectl get secret -n kafka $CLUSTER_NAME-cluster-ca-cert -o jsonpath='{.data.ca\.crt}' | base64 --decode > ca.crt
```

### Persistent Storage

So far we were using `ephemeral storage` which would be deleted when the pods dies. For a production cluster, we would do this using `Persistent Volumes`. They allow us to map external volumes for the J8 Pods. There are different ways of using PVs, refer [here](https://kubernetes.io/docs/concepts/storage/persistent-volumes/).

First make the external listeners to use Node Port and not use tls:

```
# Kafka-Cluster.yaml

...
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
      - name: external
        port: 9093
        type: nodeport
        tls: false
...
```

Apply the config:

```
kubectl apply -f kafka-cluster.yaml
```

#### Configuring the PVs

**If you are using AKS, GKS or EKS you don't need to follow these steps.**

For a persistent volume which uses the hard disk of the node, we need to configure a local persistent volume. First we create a storage class which we will reference in the `kafka-cluster.yaml`.

```
# kafka-storage-config.yaml

apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: kafka-storage
provisioner: kubernetes.io/no-provisioner
volumeBindingMode: WaitForFirstConsumer
reclaimPolicy: Retain
```

Now apply this `storageclass` with `kubectl apply -f kafka-storage-config.yaml`

Create the PVs now, one for kafka and one for zookeeper. Depending on the number of replicas you initialized, you would have to create that many PVs. In our case we have 2 kafka pods and 3 zookeeper pods. So we need total 5 PVs:

```
---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: kafka-pv
spec:
  capacity:
    storage: 5Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteOnce
  storageClassName: kafka-storage
  local:
    path: /data/kafka
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - k8-4

---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: kafka-pv-1
spec:
  capacity:
    storage: 5Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteOnce
  storageClassName: kafka-storage
  local:
    path: /data/kafka-2
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - k8-4

---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: kafka-pv-2
spec:
  capacity:
    storage: 5Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteOnce
  storageClassName: kafka-storage
  local:
    path: /data/zookeeper
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - k8-5

---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: kafka-pv-3
spec:
  capacity:
    storage: 5Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteOnce
  storageClassName: kafka-storage
  local:
    path: /data/zookeeper-2
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - k8-5

---
apiVersion: v1
kind: PersistentVolume
metadata:
  name: kafka-pv-4
spec:
  capacity:
    storage: 5Gi
  volumeMode: Filesystem
  accessModes:
    - ReadWriteOnce
  storageClassName: kafka-storage
  local:
    path: /data/zookeeper-3
  nodeAffinity:
    required:
      nodeSelectorTerms:
        - matchExpressions:
            - key: kubernetes.io/hostname
              operator: In
              values:
                - k8-5

```

When creating PVs for local-storage, it is mandatory to define the `nodeAffinity`. This is because the local PV will map to a particular directory on the node itself and it is our job to make sure that directory is available. Here I am creating 2 PVs on the node `k8-4` with directories `/data/kafka` and `/data/kafka-2` which are already created on the node.
Similarly, I have created 3 PVs on the node `k8-5` for the zookeeper pods.

For using local PV we also have to make sure that the `kafka` and `zookeeper` pods are deployed on that node where the volume is available, in my case `k8-4` and `k8-5`. To ensure that the `kafka` pods are deployed on node `k8-4` and zookeeper pods are deployed on node `k8-5` we have to make this change:

```
...
	kafka:
	...
    template:
      pod:
        affinity:
          nodeAffinity:
            requiredDuringSchedulingIgnoredDuringExecution:
              nodeSelectorTerms:
                - matchExpressions:
                    - key: kubernetes.io/hostname
                      operator: In
                      values:
                        - k8-4
	zookeeper:
		...
	    template:
	      pod:
	        affinity:
	          nodeAffinity:
	            requiredDuringSchedulingIgnoredDuringExecution:
	              nodeSelectorTerms:
	                - matchExpressions:
	                    - key: kubernetes.io/hostname
	                      operator: In
	                      values:
	                        - k8-5
```

This will deploy the pods on the correct nodes where my PVs can be mapped.
To see the node names you can use `kubectl get nodes`.

The new Kafka looks like this:

```
apiVersion: kafka.strimzi.io/v1beta2
kind: Kafka
metadata:
  name: akarx-cluster
  namespace: kafka
spec:
  kafka:
    version: 3.4.0
    replicas: 2
    listeners:
      - name: plain
        port: 9092
        type: internal
        tls: false
      - name: external
        port: 9093
        type: nodeport
        tls: false
    config:
      offsets.topic.replication.factor: 1
      transaction.state.log.replication.factor: 1
      transaction.state.log.min.isr: 1
      default.replication.factor: 1
      min.insync.replicas: 1
      inter.broker.protocol.version: "3.4"
    storage:
      type: persistent-claim
      size: 2Gi
      deleteClaim: true
      class: kafka-storage
    template:
      pod:
        affinity:
          nodeAffinity:
            requiredDuringSchedulingIgnoredDuringExecution:
              nodeSelectorTerms:
                - matchExpressions:
                    - key: kubernetes.io/hostname
                      operator: In
                      values:
                        - k8-4
  zookeeper:
    replicas: 3
    storage:
      type: persistent-claim
      size: 2Gi
      deleteClaim: true
      class: kafka-storage
    template:
      pod:
        affinity:
          nodeAffinity:
            requiredDuringSchedulingIgnoredDuringExecution:
              nodeSelectorTerms:
                - matchExpressions:
                    - key: kubernetes.io/hostname
                      operator: In
                      values:
                        - k8-5
  entityOperator:
    topicOperator: {}
    userOperator: {}
```

Now apply the config `kubectl apply -f kafka-cluster.yaml`.
We can see our pods spin up:

```
kubectl get pods -n kafka -o wide

NAME                                            READY   STATUS    RESTARTS   AGE   IP              NODE   NOMINATED NODE   READINESS GATES
akarx-cluster-entity-operator-b94445744-lqzmf   3/3     Running   0          23m   10.233.122.31   k8-4   <none>           <none>
akarx-cluster-kafka-0                           1/1     Running   0          24m   10.233.122.29   k8-4   <none>           <none>
akarx-cluster-kafka-1                           1/1     Running   0          24m   10.233.122.30   k8-4   <none>           <none>
akarx-cluster-zookeeper-0                       1/1     Running   0          25m   10.233.69.77    k8-5   <none>           <none>
akarx-cluster-zookeeper-1                       1/1     Running   0          25m   10.233.69.78    k8-5   <none>           <none>
akarx-cluster-zookeeper-2                       1/1     Running   0          25m   10.233.69.76    k8-5   <none>           <none>
strimzi-cluster-operator-6b7f585786-89h5l       1/1     Running   0          45m   10.233.102.94   k8-6   <none>           <none>
strimzi-cluster-operator-6b7f585786-jzll9       1/1     Running   0          45m   10.233.69.75    k8-5   <none>           <none>
```
Now we have the pods using the PVs we created. If you go to the actual directories on the nodes where you mapped the pods, you should see the Kafka data.
## Conclusion
We have looked at few configurations of Strimzi which should cover most of your needs. But there can be a lot more options to choose from. I have listed some important links you can refer to.
- [Overview of Strimzi Components](https://strimzi.io/docs/operators/latest/overview.html)
- [Deployment Options and Procedure](https://strimzi.io/docs/operators/latest/deploying.html)
- [Configuration options for all Strimzi components](https://strimzi.io/docs/operators/latest/configuring.html)
- [Custom Resource API](https://strimzi.io/docs/operators/latest/configuring.html#api_reference-str)
