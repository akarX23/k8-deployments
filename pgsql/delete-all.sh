kubectl delete -f pg-cluster.yaml
kubectl delete -f storage-config.yaml
minikube ssh "sudo rm -rf /data/"