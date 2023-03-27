# Postgres on Kubernetes

In this guide we will go through the setup and usage of Postgres on K8s using PGO, the Postgres Operator by Crunchy Data. It is a highly customizable operator with a features like backup and disaster recovery built into it. For reading in detail about it please refer the docs [here](https://access.crunchydata.com/documentation/postgres-operator/v5/quickstart/).

## Installing the Operator

### Pre-requisites

- A working Kubernetes cluster. A single-node cluster will work fine but it's better to have a multi-node cluster.
- Helm, a manager for Kubernetes Operator. To install, follow:

```
curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
chmod 700 get_helm.sh
./get_helm.sh
```

- A good internet connection because the docker images are large in size.

### Steps

- Clone their GitHub repo:

```
git clone https://github.com/CrunchyData/postgres-operator-examples pgo
cd pgo
```

- Make a `custom-values.yaml` file:

```
resources:
  controller:
    limits:
      memory: 12Gi
      cpu: 8000m
    requests:
      memory: 8Gi
      cpu: 4000m
  upgrade: {}
```

We give the main controller more resources for it to funciton smoothly. You can change the values according to your requirements. A full list of configurations can be found at `pgo/helm/install/values.yaml`.

- Install the operator using `helm`:

```
helm install pgo --create-namespace --namespace postgres helm/install
```

This will create a namespace called `postgres` and install the operator in that. To check the status of installation:

```
kubectl get all -n postgres

NAME                               READY   STATUS    RESTARTS   AGE
pod/pgo-569c6dfcdf-pd8sm           1/1     Running   0          3h27m
pod/pgo-upgrade-849f74bc9f-n8g9w   1/1     Running   0          3h27m

NAME                          READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/pgo           1/1     1            1           3h27m
deployment.apps/pgo-upgrade   1/1     1            1           3h27m

NAME                                     DESIRED   CURRENT   READY   AGE
replicaset.apps/pgo-569c6dfcdf           1         1         1       3h27m
replicaset.apps/pgo-upgrade-849f74bc9f   1         1         1       3h27m
```

## Running a basic postgres cluster

Before running a cluster we have to setup the Persistent Volumes. These are places where we will store the Postgres data. Learn more about [persistent volumes here](https://kubernetes.io/docs/concepts/storage/persistent-volumes/). [Follow this link](https://vocon-it.com/2018/12/20/kubernetes-local-persistent-volumes/) to setup your PVs across all nodes so that your Postgres instances can store data.

Now create a file `postgres-cluster.yaml`:

```
apiVersion: postgres-operator.crunchydata.com/v1beta1
kind: PostgresCluster
metadata:
  name: hippo
spec:
  image: registry.developers.crunchydata.com/crunchydata/crunchy-postgres:ubi8-14.7-0
  postgresVersion: 14
  instances:
    - name: instance1
      dataVolumeClaimSpec:
        accessModes:
        - "ReadWriteOnce"
        resources:
          requests:
            storage: 1Gi
  backups:
    pgbackrest:
      image: registry.developers.crunchydata.com/crunchydata/crunchy-pgbackrest:ubi8-2.41-4
      repos:
      - name: repo1
        volume:
          volumeClaimSpec:
            accessModes:
            - "ReadWriteOnce"
            resources:
              requests:
                storage: 1Gi
```

Here we create a simple Postgres cluster. We have also included a backup configuration for our database. PGO uses [pgBackRest](https://pgbackrest.org/) which is an open-source software for efficiently managing terabytes of data. We setup one repository for backup which basically says how many backups we want.

Apply this using `kubectl apply -n postgres postgres-cluster.yaml`. You can see the details of all configuration in this file [here](https://access.crunchydata.com/documentation/postgres-operator/v5/tutorial/create-cluster/).

### Connecting to our cluster

Now let's see how we can connect to our cluster. PGO created a number of services when creating the cluster. To see all the services:

```
kubectl -n postgres get svc --selector=postgres-operator.crunchydata.com/cluster=hippo

NAME              TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)    AGE
hippo-ha          ClusterIP   10.103.73.92   <none>        5432/TCP   3h14m
hippo-ha-config   ClusterIP   None           <none>        <none>     3h14m
hippo-pods        ClusterIP   None           <none>        <none>     3h14m
hippo-primary     ClusterIP   None           <none>        5432/TCP   3h14m
hippo-replicas    ClusterIP   10.98.110.215  <none>        5432/TCP   3h14m
```

The connection information like user, password, host and port is stored in a secret which has the format of `<cluster-name>-pguser-<username>`. The default user that is created is same as the cluster name, in our case `hippo`. So the secret is `hippo-pguser-hippo`. You can access the secret with `kubectl describe -n postgres secret hippo-pguser-hippo`.

If you are trying to connect to this postgres cluster from some external application, you would need to access it through a service like [NodePort](https://kubernetes.io/docs/concepts/services-networking/service/#type-nodeport).

To see more details about modifying service types and connecting to cluster, click [here](https://access.crunchydata.com/documentation/postgres-operator/v5/tutorial/connect-cluster/).

## Setting up a High-Availability Cluster

PGO protects our cluster from downtime in case anything goes wrong by having multiple instances of a postgres instance. There are two ways an HA cluster can be set up:

- Increase the `spec.instances.replicas` value
- Adding another instance to `spec.instances`

This will setup multiple postgres pods that will elect 1 master amongst themselves and if the master goes down, a pod will be assigned master immediately and PGO will bring up the other pod.

To test HA and learn more about how HA can be achieved, [refer](https://access.crunchydata.com/documentation/postgres-operator/5.3.1/tutorial/high-availability/) here.

## Resizing a Postgres Cluster

Once you have successfully run a HA cluster and are able to connect to it, it's time to increase it's resources and storage. PGO allows you to change the resource allocation for different containers. To see a list of all configurable resources options, refer [here](https://access.crunchydata.com/documentation/postgres-operator/5.3.1/tutorial/resize-cluster/).

You can also resize the storage volumes. However there are some limitations:

- Volumes can be directly resized only [if the storage class supports it](https://kubernetes.io/blog/2018/07/12/resizing-persistent-volumes-using-kubernetes/).
- Volumes can not be shrunk down to a smaller size directly.

The PGO documentation does provide a way around both these limitations. It involves creating a new instance in `spec.instances` with the new volume size. Once this instance is in sync with the previous one, you can delete the previous instance and your cluster will be healthy. This method can be used to downsize a volume as well. Read more at the end of [this page](https://access.crunchydata.com/documentation/postgres-operator/5.3.1/tutorial/resize-cluster/).

### Customizing a Postgres Cluster

PGO offers a wide variety of options to customize our cluster. You can find all of them [here](https://access.crunchydata.com/documentation/postgres-operator/5.3.1/tutorial/customize-cluster/). Here we will talk about 2 important ones: **Patroni** and **TLS/SSL**.

#### What is Patroni?

Patroni is a python based Postgres cluster manager. It helps in automation and deployment of a Postgres cluster. PGO uses patroni under the hood to ensure the cluster remain healthy and all configurations are applied to the instances. Read more about patroni [here](https://patroni.readthedocs.io/en/latest/). Patroni has its own list of configuration options that can be manipulated using PGO. To do this, add the following to your `postgres-cluster.yaml`:

```
spec:
  patroni:
    dynamicConfiguration:
      postgresql:
        parameters:
          max_parallel_workers: 2
          max_worker_processes: 2
          shared_buffers: 1GB
          work_mem: 2MB
```

To see a list of all configuration options, refer [here](https://patroni.readthedocs.io/en/latest/dynamic_configuration.html).

#### TLS/SSL

By default PGO will use TLS for all internal communication. It generates its own TLS keys and certificates which it stores as secrets. We can use our own certificates and keys as well using the `spec.customTLSSecret`. We need to make a secret first where we put our certificates and key. Read more [here](https://access.crunchydata.com/documentation/postgres-operator/5.3.1/tutorial/customize-cluster/).

Other things we can customize:

- We can change the database specific parameters like max_parallel_workers or max_worker_processes. These changes are applied to all instances.
- Custom TLS
- Custom Labels
- Separate WAL PVCs
- Database Initialization SQL - Intialize database with some setup SQL

### User / Database Management (Tested)

We can specify a list of users in the database as well as the databases they have access to. We can also give separate privileges to each user. **We cannot delete a user or database directly from yaml. For that we need to manually delete from the pgsql CLI or a DB Management Tool.**

### Applying Software updates (Works)

We can just specify the new image in the yaml and all pods will be updated with a rolling update strategy.

### Backups (Some Tested)

#### Types of Backups:

- Azure
- S3
- AWS
- K8 Persistent Volumes (Tested)

#### Multi Repository Backup

PGO allows us to backup in 4 locations simultaneously. We can also mix between the four types of backups. PGO also allows for encrypted backups.

#### Management (Not Tested)

- Scheduled Backups
- Backup retention policies
- Taking One-Off Backup

### Restoring Backups

- Restoring from an existing Postgres Cluster in the K8 Cluster which is useful if we are using Persistent Volumes in our cluster (Tested).
- Point In Time Recovery from another Cluster (Tested).
- In-Place Point-in-time-Recovery from an existing backup (Not Tested).
- Restore Selected Databases (Not Tested).
- Restoring from a Cloud Backup (Not Tested)

### StandBy Cluster (Not Tested)

PGO allows us to span the Postgres Cluster across multiple K8 Clusters with external storage and streaming. However, this will work only with cloud storage and not K8 persistent volumes.

### Monitoring (Not Tested)

PGO allows us to add a sidecar to our cluster which exports database metrics. These metrics can be picked up by monitoring tools like Prometheus, Grafana and Alert Manager.

### Connection Pooling (Tested)

PGO allows us to pool connections using pgBouncer. This is helpful for a high functioning database. There are several ways to customize it like resources and affinities. We can also deploy multiple replicas of pgBouncer but **care must be taken to not overload the database with connections.**

# Conclusion

We have thought about most of the configuration options and use cases for the PGO operator. Here are some important links to refer to:

- [Installing PGO](https://access.crunchydata.com/documentation/postgres-operator/v5/installation/helm/)
- [Architecture in depth](https://access.crunchydata.com/documentation/postgres-operator/v5/architecture/)
- [Tutorial](https://access.crunchydata.com/documentation/postgres-operator/v5/tutorial/) for different ways to use PGO
- [Postgres Cluster CRD](https://access.crunchydata.com/documentation/postgres-operator/v5/references/crd/#postgrescluster)
