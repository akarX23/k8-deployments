# Memcached on Kubernetes

Memcached is an high-performance, distributed memory object caching system, generic in nature, but intended for use in speeding up dynamic web applications by alleviating database load.

We deploy Memcached on Kubernetes using a **[helm chart by bitnami.](https://github.com/bitnami/charts/blob/main/bitnami/memcached/README.md)** There is not a lot of development regarding Memcached on Kubernetes, most of the projects are deprecated. This chart gives us most of the required features but you might require some more advanced configuration.

In this guide we will go through the steps for setting up the chart as well as the configuration options. We will also setup connection pooling seperately for our memcached cluster.

## Pre-requisites

- Working Kubernetes cluster
- Helm installed
- Storage Class configured for PV. We will need a minimum of one PV.

## Installing the chart with HELM

Add the chart to your helm repositories:

```
helm repo add bitnami https://charts.bitnami.com/bitnami
```

Before installing the chart check [all the configuration options](https://github.com/bitnami/charts/blob/main/bitnami/memcached/values.yaml) available for this chart. We will go with a minimal configuration:

```
global:
  storageClass: "longhorn"

fullnameOverride: "mc-operator"

architecture: high-availability

replicaCount: 3

resources:
  limits: {}
  requests:
    memory: 512Mi
    cpu: 250m

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 6
  targetCPU: 50
  targetMemory: 50

service:
  type: NodePort
  ports:
    memcached: 11211
  nodePorts:
    memcached: 30211

persistence:
  enabled: true
  storageClass: "longhorn"
  accessModes:
    - ReadWriteOnce
  size: 2Gi
```

Important points in the above configuration:

- `global.storageClass`: This storage class will be used to provision all PVs for your cluster.
- `architecture`: Can be stand-alone or high-availability.
- `replicaCount`: The number of instances of memcached to run. One PV will be required for every replica.
- `service`: The type of service which will expose the memcache pods.
- `autoscaling`: If enabled, a [HPA](https://kubernetes.io/docs/tasks/run-application/horizontal-pod-autoscale/) will be spawned for scaling the cluster. This will use only CPU and Memory to scale. **If you want to scale on extra metrics, enable `metrics.enable` and setup your own HPA.**

Save your configuration in a `custom-values.yaml` file. Install the chart

```
helm install memcached bitnami/memcached --create-namepsace --namespace memchached -f custom-values.yaml
```

This will install the chart in a separate namespace called `memcached`.

**Note: This chart doesn't provide any CRDs, it will start the memcached pods straight away.**

To verify if the installation was successful execute `kubectl get all -n memcached` and you should see your pods and services..

### Updating the cluster

The cluster is updated by changing your `custom-values.yaml` file. Once you have the configuration you need, execute

```
helm upgrade memcached bitnami/memcached --namespace memchached-operator --create-namespace -f custom-values.yaml
```

## Features

The bitnami chart doesn't provide a lot of features but there are some good ones:

- Prometheus exporter for metrics
- Out-of-the-box autoscaling
- Authentication

## Connection pooling

For connection pooling in memcached we will use an amazing library developed by facebook called [mcrouter](https://github.com/facebook/mcrouter). Mcrouter doesn't have a stable way of being deployed on Kubernetes yet so we will use our own deployment.

**For a memcached deployment, you should definitely deploy mcrouter.**

You can read about all mcrouter features [here](https://github.com/facebook/mcrouter/wiki/Features).

Before installing mcrouter, we need to make a configuration file that MCrouter will use. Create a file called `mcrouter.conf` with these contents:

```
{
  "pools": {
    "A": {
      "servers": [
        "MEMCACHED-SERVICE-NAME.MEMCACHE-NAMESPACE.svc.cluster.local:11211",
      ]
    }
  },

  "route": {
    "type": "PoolRoute",
    "pool": "A"
  },

  "protocol": {
    "type": "ascii"
  }
}
```

Put the values of your memcached deployment above so that mcrouter can use our memcached instances for routing traffic. Now create a config map of the above file:

```
# Create mcrouter namespace
kubectl create ns mcrouter

# Create config map
kubectl create configmap mcrouter-config -n mcrouter --from-file=mcrouter.conf
```

View all options you can include in this configuration file [here](https://github.com/facebook/mcrouter/wiki/Config-Files).

Now let's create a deployment for our mcrouter. Create a `mcrouter.yaml` file with this content:

```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcrouter
  namespace: mcrouter
spec:
  replicas: 3
  selector:
    matchLabels:
      app: mcrouter
  template:
    metadata:
      labels:
        app: mcrouter
    spec:
      containers:
        - name: mcrouter
          image: mcrouter/mcrouter
          args: ["-p", "5000", "--config-file", "/etc/mcrouter/mcrouter.conf"]
          volumeMounts:
            - name: mcrouter-config
              mountPath: /etc/mcrouter
      volumes:
        - name: mcrouter-config
          configMap:
            name: mcrouter-config

---
apiVersion: v1
kind: Service
metadata:
  name: mcrouter
  namespace: mcrouter
  labels:
    app: mcrouter
spec:
  type: ClusterIP
  ports:
    - name: mcrouter
      port: 5000
  selector:
    app: mcrouter

```

Here we have defined three replicas of mcrouter and in the containers section we pass some command line arguments which point to the configuration file. In the volume mounts we have mapped the config map to the directory inside the pods. To see **all command line options**, refer [here](https://github.com/facebook/mcrouter/wiki/Command-line-options).

We have also created a service of type `ClusterIP` to connecto the mcrouter pod, you can use `ClusterIP` if some internal Kubernetes component will access Memcached or use `NodePort` if you want to connect from outside.

Noe deploy this file using `kubectl apply -f mcrouter.yaml`.

## Connecting to the cluster

We will run a test pod which will be able to connect with the mcrouter service and access the memcached cluster. You can also use the same method to connect directly with the Memcached cluster.

We will use telnet to open a session from our test pod:

```
 kubectl run -it --rm alpine --image=alpine:3.6 --restart=Never telnet MCROUTER-SERVICE-NAME.MCROUTER-NAMESPACE.svc.cluster.local 5000
```

You can replace `MCROUTER-SERVICE-NAME` and `MCROUTER-NAMESPACE` with mcrouter or memcached values. This will open a command prompt in your terminal from where you can set and get keys in your memcached cluster.

## Conclusion

Although Memcached isn't very developed for Kubernetes like other workloads in this repository, you can still use it and it will work well ensuring High Availability and scaling. But backup and recovery is something we will have to manually configure.
