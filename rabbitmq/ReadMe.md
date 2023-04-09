# Rabbit MQ on Kubernetes

> RabbitMQ is lightweight and easy to deploy on premises and in the cloud. It supports multiple messaging protocols. RabbitMQ can be deployed in distributed and federated configurations to meet high-scale, high-availability requirements.

Rabbit MQ provides its own operators for Kubernetes which help you setup a production grade deployment of Rabbit MQ on Kubernetes. They maintain two operators:
- RabbitMQ Cluster Kubernetes Operator automates provisioning, management, and operations of RabbitMQ clusters running on Kubernetes.
- RabbitMQ Messaging Topology Operator manages RabbitMQ messaging topologies within a RabbitMQ cluster deployed via the RabbitMQ Cluster Kubernetes Operator.

## Features 
Here is a list of all features currently supported by the **Cluster Operator**:
- Automated creation and scaling of RabbitMQ clusters as Kubernetes Custom Resources
- Automated cluster healing to recover from node failures and ensure high availability
- Rolling upgrades for RabbitMQ clusters, with no downtime or message loss
- Customizable RabbitMQ configuration via Kubernetes Custom Resources
- Integration with Kubernetes-native tools such as Prometheus and Grafana for monitoring and alerting
- Support for secure communication with TLS encryption
- Support for RabbitMQ plugins and management of their lifecycle
- Integration with HashiCorp Vault for secrets

For more information about the operators, refer [here](https://www.rabbitmq.com/kubernetes/operator/operator-overview.html). In this guide we will setup the operator on a K8 cluster and then set up a sample RabbitMQ Cluster with the operator. We will also setup monitoring and benchmarking our setup.

## Pre-requisites
- A working K8 cluster
- `kubectl` configured with the cluster
- `helm` installed
- If you want to setup monitoring, make sure you have at least **Prometheus** setup. For setting up `Prometheus` and `Grafana` you can refer to [this blog](https://medium.com/@akarX23/deploying-prometheus-and-grafana-in-a-multi-node-kubernetes-cluster-and-auto-scaling-with-keda-eccecfbd8950). 

## Setup the Operator
We will install the Rabbit MQ operator using the [helm chart available at bitnami](/bitnami/rabbitmq-cluster-operator#parameters).
```
# Add the bitnami repo
helm repo add my-repo https://charts.bitnami.com/bitnami
```
Before installing the chart, we will create a `custom-values.yaml` file which will configure the chart. The complete list of options can be found [here](https://github.com/bitnami/charts/tree/main/bitnami/rabbitmq-cluster-operator#parameters).
The configuration we will use looks like this:
```
fullnameOverride: "rabbit-clus-op"

clusterOperator:
  replicaCount: 2

  resources:
    limits:
      memory: 12Gi
      cpu: 8000m
    requests:
      memory: 8Gi
      cpu: 4000m

  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: type
                operator: In
                values:
                  - master

  metrics:
    enabled: true
    serviceMonitor:
      enabled: true
      interval: 10s
      # namespace: rabbitmq-system

msgTopologyOperator:
  replicaCount: 2

  fullnameOverride: "rabbit-msg-op"

  resources:
    limits:
      memory: 8Gi
      cpu: 4000m
    requests:
      memory: 6Gi
      cpu: 2500m

  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: type
                operator: In
                values:
                  - master

  metrics:
    enabled: true
    serviceMonitor:
      enabled: true
      interval: 10s
      # namespace: rabbitmq-system
```
We have setup 2 replica pods for each operator and set the resource configuration for each. We have also enabled metrics for each pod which will run a **metrics exporter** container in each pod for both operators. The `serviceMonitor` key is used to create the **ServiceMonitor** which will be picked up by the Prometheus Operator running in the cluster. If you don't have the Prometheus Operator you can omit this. Lastly I have setup affinities so that the operator pods are scheduled in the master nodes of our K8 cluster. 

Now install the operator:
```
helm install my-release my-repo/rabbitmq-cluster-operator --create-namespace --namespace rabbitmq-system -f custom-values.yaml
```
This will create a namespace `rabbitmq-system` which will contain all the cluster resources.  You can check all the resources using `kubectl get all -n rabbitmq-system`.

## Setup RabbitMQ Cluster
The RabbitMQ operator provides us a CRD called `RabbitmqCluster` through which we define all the configurations for our cluster. RabbitMQ has some [examples](https://github.com/rabbitmq/cluster-operator/tree/main/docs/examples) for different use cases. Entire list of configurable parameters along with their description can be found [here](https://www.rabbitmq.com/kubernetes/operator/using-operator.html#create). In our case we will use this template:
```
apiVersion: rabbitmq.com/v1beta1
kind: RabbitmqCluster
metadata:
  name: akarx-rabbit-cluster
  namespace: rabbitmq-test-app
spec:
  replicas: 3
  persistence:
    storageClassName: longhorn
    storage: 5Gi
  resources:
    requests:
      cpu: 2000m
      memory: 3Gi
    limits:
      cpu: 2000m
      memory: 3Gi
  affinity:
    nodeAffinity:
      requiredDuringSchedulingIgnoredDuringExecution:
        nodeSelectorTerms:
          - matchExpressions:
              - key: type
                operator: In
                values:
                  - worker
```
Here we have defined the namespace as `rabbitmq-test-app` and set 3 replicas of rabbitmq instances. We have also defined some resource specifications along with `nodeAffinity` since I want my RabbitMQ instances on the worker pods only. We have also given a **PersistentVolume** of `5Gi` for each pod, make sure you have these available or else your pods will fail to start,

Be default, the [rabbitmq-prometheus plugin](https://www.rabbitmq.com/prometheus.html) is installed which exposes a lot of metrics for our cluster on port `15692` of the pods. To view these metris we will set up a `serviceMonitor` which will be picked up by the **Prometheus Operator** installed in our cluster. For more information about monitoring, refer [here](https://www.rabbitmq.com/kubernetes/operator/operator-monitoring.html).

Add this configuration just below the above code:
```
---
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: akarx-rabbit-cluster
  namespace: rabbitmq-test-app
spec:
  selector:
    matchLabels:
      app.kubernetes.io/name: akarx-rabbit-cluster
  endpoints:
    - interval: 10s
      port: prometheus
  namespaceSelector:
    matchNames:
      - rabbitmq-test-app
```
Here we have instructed the `serviceMonitor` to look in the `rabbitmq-test-app` namespace and select the service with the labels `app.kubernetes.io/name: akarx-rabbit-cluster` since that is the label used by the service created by the `RabbitMQ-Operator`. Now apply the file to the cluster:
```
kubectl apply -f rabbit-cluster.yaml
```
We should see our pods and services spin up. You can view all the resources with `kubectl get all -n rabbitmq-test-app` which should produce:
```
NAME                                READY   STATUS    RESTARTS   AGE
pod/akarx-rabbit-cluster-server-0   1/1     Running   0          81m
pod/akarx-rabbit-cluster-server-1   1/1     Running   0          81m
pod/akarx-rabbit-cluster-server-2   1/1     Running   0          81m
pod/perf-test-5cpbf                 1/1     Running   0          27m

NAME                                 TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)                        AGE
service/akarx-rabbit-cluster         ClusterIP   10.233.47.63   <none>        5672/TCP,15672/TCP,15692/TCP   81m
service/akarx-rabbit-cluster-nodes   ClusterIP   None           <none>        4369/TCP,25672/TCP             81m

NAME                                           READY   AGE
statefulset.apps/akarx-rabbit-cluster-server   3/3     81m

NAME                  COMPLETIONS   DURATION   AGE
job.batch/perf-test   0/1           27m        27m

NAME                                                ALLREPLICASREADY   RECONCILESUCCESS   AGE
rabbitmqcluster.rabbitmq.com/akarx-rabbit-cluster   True               True               81m
```
The operator also creates credentials for the default user in a secret `cluster-name-default-user`. To see all the credentials:
```
kubectl get secret -n rabbitmq-test-app akarx-rabbit-cluster-default-user -o json | jq -r '.data | to_entries[] | "\(.key):\(.value | @base64d)"'

# Output
default_user.conf:default_user = default_user_Taaro-VOtoVZFSkNsaG
default_pass = ObHL8k2fIhjekJ0mt6WXQwSMzERZ-qOk
host:akarx-rabbit-cluster.rabbitmq-test-app.svc
password:ObHL8k2fIhjekJ0mt6WXQwSMzERZ-qOk
port:5672
provider:rabbitmq
type:rabbitmq
username:default_user_Taaro-VOtoVZFSkNsaG
```
You can use these credentials to connect your application to the RabbitMQ Cluster. 

### Install Grafana Dashboards
RabbitMQ gives us a bunch of dashboards to monitor the cluster and different metrics. To view all the dashboards, refer [here](https://grafana.com/orgs/rabbitmq/dashboards). Install the **RabbitMQ-Overview** dashboard, it can be found [here](https://grafana.com/grafana/dashboards/10991-rabbitmq-overview/).
### Performance testing our cluster 
Rabbit MQ has a tool called [PerfTest](https://github.com/rabbitmq/rabbitmq-perf-test) which can be used to test our cluster. To install and run **PerfTest** use these commands:
```
instance=akarx-rabbit-cluster
namespace=rabbitmq-test-app
username=$(kubectl get secret -n ${namespace} ${instance}-default-user -o jsonpath="{.data.username}" | base64 --decode)
password=$(kubectl get secret -n ${namespace} ${instance}-default-user -o jsonpath="{.data.password}" | base64 --decode)
service=$(kubectl get secret -n ${namespace} ${instance}-default-user -o jsonpath="{.data.host}" | base64 --decode)
kubectl run perf-test --image=pivotalrabbitmq/perf-test -- --uri "amqp://${username}:${password}@${service}"
```
This will run the **PerfTest** pod and load test the cluster. View the logs with:
```
kubectl logs perf-test -f

# Output
id: test-155830-565, time 8.002 s, sent: 52020 msg/s, received: 6990 msg/s, min/median/75th/95th/99th consumer latency: 5952457/6352125/6586997/6723006/6783867 µs
id: test-155830-565, time 9.002 s, sent: 2153 msg/s, received: 15326 msg/s, min/median/75th/95th/99th consumer latency: 6799943/7147521/7290141/7404366/7425979 µs
id: test-155830-565, time 10.002 s, sent: 0 msg/s, received: 13103 msg/s, min/median/75th/95th/99th consumer latency: 7410214/7699436/7815445/7955350/8026309 µs
id: test-155830-565, time 11.002 s, sent: 0 msg/s, received: 200 msg/s, min/median/75th/95th/99th consumer latency: 8752405/8763742/8767803/8818141/8818438 µs
```
If you see in your **RabbitMQ-Overview Grafana Dashboard** you will see the graphs rise.

Delete the pod with ` kubectl delete pods perf-test`. 

## Conclusion
This completes our testing with the RabbitMQ Cluster Operator. View the rest of the docs [here](https://www.rabbitmq.com/kubernetes/operator/using-operator.html).  In the docs they have used a plugin for kubectl which can make some of the commands easier. We haven't used the plugin in this guide anywhere but you can definitely experiment with it. A very good use of the plugin is to run the `PerfTest` against our cluster which can be done by a simple command `kubectl rabbitmq -n rabbitmq-test-app perf-test akarx-rabbit-cluster`.
