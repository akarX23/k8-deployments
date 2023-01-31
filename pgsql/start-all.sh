minikube ssh "sudo mkdir /data/backup /data/postgres /data/postgres2"
kubectl apply -f storage-config.yaml
kubectl apply -f pg-cluster.yaml