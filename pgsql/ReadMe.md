 # Postgres deployment on K8
 
 ## Overview
 In this deployment we are using minikube for a local single node cluster. We use local storage to persist the data. This local storage path exists inside minikube itself. We use persistent volumes to create local storage inside our minikube node. Then we mount the **pgsql** database on this storage. Learn more about [persistent volumes here](https://kubernetes.io/docs/concepts/storage/persistent-volumes/). 

## Features

### High Availability (Tested)

Multiple instances of postgres database can be deployed with each having a separate volume for itself. If one of the instance goes down it is instantly restarted with the data intact. Also if the master goes down, a slave will be instantly promoted to master thus maintaining connection. **One thing to keep in mind - if the stateful set is deleted,  a new set is summoned which keeps the database alive but the application which is connected loses connection. So the application will need to have some mechanism to try to connect to the database with a predefined number of retries for full functioning.**
 
### Synchronous Replication (Tested)

If synchronous replication is switched on, PGO will wait for trasactions to be written to at least one additional server before it considers the transaction to be committed. This allows for limited transaction loss but affects database speed.

### Affinities (Works)

Using Pod Afiinity and Anti-Affinity constraints provided by K8 itself, we can schedule pods conditionally to be deployed on specific nodes of the cluster. For example, we might want the master postgres instance to be deployed on the master node of our cluster.

### Resizing Instances (Not Tested)

PGO allows us to resize instances by altering their resource requirements or expanding volume or both. **Volumes can not be shrunk**. Volume expansion works only when StorageClass supports it. If not then PGO provides a second way to expand volume by deploying a second instance. **Volume expansion has not been tested yet.** For more info, [look here.](https://access.crunchydata.com/documentation/postgres-operator/5.3.0/tutorial/resize-cluster/)

### Customizing Postgres Confguration (Some Tested)

 - We can change the database specific parameters like max_parallel_workers or max_worker_processes. These changes are applied to all instances. (Tested)
 - Custom TLS (Not Tested)
 - Custom Labels (Tested)
 - Separate WAL PVCs (Not tested)
 - Database Initialization SQL - Intialize database with some setup SQL (Tested)
 
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



 ## Requirements to run this guide
 
 - Working minikube cluster. [Refer this](https://phoenixnap.com/kb/install-minikube-on-ubuntu) for Ubuntu. 
 - Knowledge of K8 components
 - Experience with Kubectl CLI
 - git
 
  ## Caution
  
  The steps shown below have been tested on local deployment with Minikube. You should have no problem in setting up the environment on a multi-node cluster either. But there can be issues while setting up persistent volumes (PV) in a multi-node cluster.
  
  ## Setup of Postgres Operator (PGO)
  
  ### An overview of PGO
  
  PGO is an unofficial operator by CrunchyData. It gives a lot of powerful features for us to use in Kubernetes. You can read more about PGO [here](https://access.crunchydata.com/documentation/postgres-operator/v5/).
  
  ### Steps to setup PGO in K8
  
  - Clone the PGO repo:
```
git clone https://github.com/CrunchyData/postgres-operator-examples.git
cd postgres-operator-examples
```
- Install PGO
```
# Create postgres-operator namespace
kubectl apply -k kustomize/install/namespace

# Install PGO components
kubectl apply --server-side -k kustomize/install/default
```
- Check status of installation
```
kubectl -n postgres-operator get pods --selector=postgres-operator.crunchydata.com/control-plane=postgres-operator

NAME                                READY   STATUS    RESTARTS   AGE
postgres-operator-9dd545d64-t4h8d   1/1     Running   0          3s 
  ```
  Make sure pods are in `Running` status.
  
  # Create a Postgres Cluster
  The PGO we set just setup installed some CRDs for us. This is the `PostgresCluster` CRD 
  which gives the template to specify all kinds of settings for the Postgres Cluster.
