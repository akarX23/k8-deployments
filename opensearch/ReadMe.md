# Opensearch on Kubernetes

In this guid we will go through the steps required to setup a **Highly Available** and **Scalable** on Kubernetes. This has been tested on a **KVM Machine** with a 9 node Kubernetes Cluster.

## Overview

Opensearch provides an official [Helm Chart](https://github.com/opensearch-project/helm-charts) that can be used to deploy an Opensearch Cluster on Kubernetes. There are 2 Helm charts provided:

- [Opensearch](https://github.com/opensearch-project/helm-charts/tree/main/charts/opensearch): This chart is used to deploy the Opensearch Cluster. It is highly customizable and works seamleslly with the latest **Opensearch 2.7**.
- [Opensearch Dashboards](https://github.com/opensearch-project/helm-charts/tree/main/charts/opensearch-dashboards): This chart is used for a separate deployment of the Opensearch Dashboards. It connects with an existing Opensearch Cluster and is highly customizable as well.

## Opensearch Cluster Deployment

The **Opensearch** helm chart does not provide an operator as such, it just installs the manifests required to setup Opensearch nodes based on the configuration provided. An Opensearch cluster requires multiple deployments of this helm chart since one deployment provisions one type of Opensearch Nodes, called a **Node Group**. Each node deployed with a single deployment of the chart will have the same **node roles**. For example, you can have one deployment for _Cluster Manager nodes_ with node roles as _data,ingest,master_ and another deployment for _Data nodes_ with node roles as _data,ingest_. The entire list of configuration options can be found [here](https://github.com/opensearch-project/helm-charts/tree/main/charts/opensearch#configuration).

### Our Setup

Our Opensearch consists of **3 Cluster Manager Nodes** with Node Roles as **_master, ingest, data, remote_cluster_client_** located in the [masters.yaml](https://github.com/akarX23/k8-deployments/blob/master/opensearch/masters.yaml) file and **5 Cluster Data Nodes** with Node Roles as **_data,ingest_** located in the [data.yaml](https://github.com/akarX23/k8-deployments/blob/master/opensearch/data.yaml) file. If the Opensearch Image exists on the cluster, the cluster takes about a minute to come up completely. We have **disabled** the **Opensearch Security Plugin** for testing purposes. **Resources** and **Java Heap Size** have also been configured. For persistence storage we have used **_Longhorn_** as the storage provisioner - this gives us the ability to dynamically provision storage in a local deployment which is necessary when we autoscale the cluster later.

There are three important configurations in our setup:

- `vm.max_map_count` - We were running into permission issues inside the pods when trying to set the _max_map_count_ and _fs.file-max_. To resolve this we run an extra init container with escalated privileges to set the desired values. **You may, however, not run into this issue**, in which case you can remove the `extraInitContainers` configuration in the `masters.yaml` and `data.yaml` file.
- Enabling **Performance Analyzer Tool** - PAT is installed by default in the Opensearch image but to enable it we run a `postStart` script in the Opensearch Container on each pod with the `opensearchLifecycle.postSart` hook.
- **Draining Nodes on scale down** - Scaling up node is easy, just add a new node in the cluster and it will start ingesting data. But in scale down we cannot just kill a Pod, we need to copy its data to the other nodes first. The `lifecycle.preStop` does that job. This is explained in more detail in the **Autoscaling setup** later.

### Resources deployed by the Opensearch Chart

- One **StatefulSet** per deployment which manages the pods of that particular **Node Group**.
- Two services per deployment - One is the main service which points to the Opensearch continer, Second service which is a headless service responsible for internal communication b/w the nodes in our OS cluster.
- Ingress if enabled which points to the main service for HTTP Communication.

### Autoscaling Setup

The Opensearch chart deploys a **stateful set** for each deployment of the chart. We will be scaling the cluster using the Kubernetes native **HorizontalPodAutoscaler** on the **StatefulSets**. The HPA configuration is stored in the `hpa.yaml` file. The metric used to autoscale, provided by the **Metrics Server** installed on the K8 Cluster, is `averageCpuUtilization`. This is calculated based on the resources provided in the `masters.yaml` and `data.yaml`. In our case, the threshold value is **20**.

#### Scaling Out

When the load on the Opensearch cluster increases the CPU Utilization above the threshold value (20 in our case), the HPA sends a signal to the StatefulSets to increase the number of pods. The additional pods spinned up discover the cluster using the `akarx-cluster-master` service that is deployed by the Opensearch chart. Once a **cluster_manager** node is discovered, the new pod attaches itself to the cluster and starts ingesting data. This process takes nearly **15 to 20 secs** to complete.

#### Scaling down

When the load starts decreasing and the CPU Utilization reaches around the threshold value, the HPA sends the stop signal to the StatefulSets. The extra pods are put in the termination state but not immediately killed. As explained above, this is necessary so that the cluster has some time to rebalance itself before moving data from the terminating node.

Before going further, let's discuss **how Opensearch rebalances data** when a node is killed. As soon as a node is killed, Opensearch goes in a state of **yellow** from **green**. This means that there are shards in the cluster which are not assigned a node. These are the shards of the pods that have been killed. Opensearch starts copying the data in those shards to the other nodes in the cluster. Once all shards have been assigned, the cluster comes back to a state of **green**. A state of **red** means that some shards cannot be assigned to any node, leading to potential data loss.

**How do we manage the draining of data nodes in our setup?**
From above it's clear that if a lot of nodes went down at once, it will be hard for the cluster to rebalance since there will be a lot of data to copy and not a lot of nodes to copy it to. Also, it's clear that Opensearch doesn't start rebalancing the cluster when the pods are in the `Terminating` state. Here is where our `lifecycle.preStop` shines. **HPA doesn't scale down all pods at once**, but it does in **small batches** which can also be configured. However, as soon as some pods are killed, the cluster goes in **yellow** state. In the `preStop` script we first set the **number of replicas** to **1** so that there will be less data for the cluster to move. We then run a **while** loop to check the cluster health, if it's **green** the script exits and the pod is shut down. Immediately, the cluster health is set to **yellow** by Opensearch and now any pods scheduled for termination by the HPA will remain in the `Termination` state until the cluster restores itself to **green**. The maximum time for which the script can run is defined by the `terminationGracePeriod` in the Opensearch chart deployment files. In our case it is **120 seconds**. This means that the pods will wait for a maximum of **120 seconds** for the cluster health to go **green** before forcefully shutting down.

**Outcome**
When we ran the benchmark (discussed later) without the `preStop` script, the cluster ended up in a `red` state which would lead to data loss. With the `preStop` script on the same cluster configuration and same benchmark, the cluster remained in a state of **green** while going into **yellow** multiple times which is normal. This resulted in **no data loss**.

> The PreStop hook is called immediately before a container is terminated. It is blocking, meaning it is synchronous, so it must complete before the call to delete the container can be sent.

We followed [this link](https://jinnabalu.medium.com/scaling-down-an-elasticsearch-cluster-da92d5c64c97) for scaling down an Opensearch Cluster the right way.

### Benchmarking

We used the **Opensearch Benchmark** tool which runs on a completely separate VM. It is pointed to the Opensearch Cluster using an Ingress which in turn points to the `akarx-master-service` of the cluster. Command to run the benchmark:

```
opensearch-benchmark execute_test --target-hosts=os.cluster:80 --pipeline benchmark-only --workload geopoint --kill-running-processes --results-file result.csv --results-format markdown
```

where `os.cluster` is the Ingress host.

The HPA detected the increase in load and the extra pods were spun up which joined the cluster and shared the load. We also continuosly checked the cluster health and it remained **green** until the cluster was scaling out. When the load reduced, the pods were put in a `terminating` state. On the shutdown of a pod, the cluster went into **yellow** state while the next batch of pods were still in terminating state. As the cluster regains its health, those pods are also brought down.

### Scaling Policies

We experimented with scaling policies with the HorizontalPodAutoscaler. In our setup, we put policies in place where:

- The master pods will be sent the **scaleDown signal** for **maximum of 1 pods in 60 seconds**, and a **scaleUp signal** of maximum of **2 pods in 60 seconds**.
- The master pods will be sent the **scaleDown signal** for **maximum of 2 pods in 60 seconds**, and a **scaleUp signal** of maximum of **3 pods in 60 seconds**.

**Outcome**
The cluster had enough time to rebalance itself when pods left since not a lot of nodes will die at once.
