# K8 Cluster behind an HA-Proxy and NGINX Ingress Controller

Developing a Highly Available Kubernetes Cluster is a big requirements for things to work smoothly. In this guide we will discuss how does HA Proxy and NGINX Ingress Controller help us in developing a highly available K8 cluster.

## Pre-requisites

- A working Kubernetes cluster and access to the kubeadm configuration file
- A separate server for HA-Proxy
- Connectivity on all servers
- Helm installed

## Task to be performed

- Install HA Proxy on the server
- Add the Kube API Server configuration in ha-proxy so that we can forward `kubectl` commands through HA-Proxy to the Kube API Server
- Connect to the cluster using `kubectl` , both securely and insecurely
- Deploy NGINX Controller on the cluster
- Deploy an example-nginx app
- Create an Ingress to connect to the example app from outside the cluster

## Steps

### Install HA Proxy on server

SSH into the server reserved for HA Proxy. First you need to install haproxy on the server.

```
# Ubuntu
sudo apt install haproxy -y

# Cent OS
 yum install haproxy
```

Before starting HA Proxy we will modify the default config file and add the configuration for `Kube API Server`. Here we will use the Master Node IPs to load balance the traffic.

```
# Become root
sudo su

# Make a backup of the old file
 mv /etc/haproxy/haproxy.cfg /etc/haproxy/temp.cfg

# Create new file
nano /etc/haproxy/haproxy.cfg
```

Paste the following (Replace `<master-ips>` with your master node IPs):

```
global
    log /dev/log  local0 warning
    chroot      /var/lib/haproxy
    pidfile     /var/run/haproxy.pid
    maxconn     4000
    user        haproxy
    group       haproxy
    daemon

   stats socket /var/lib/haproxy/stats

defaults
  log global
  option  httplog
  option  dontlognull
        timeout connect 5000
        timeout client 50000
        timeout server 50000


frontend k8_api
    bind *:6443
    option tcplog
    mode tcp
    default_backend k8s_api_server

backend k8s_api_server
    mode tcp
    option tcp-check
    balance roundrobin
    option forwardfor
    http-send-name-header Host
    default-server inter 10s downinter 5s rise 2 fall 2 slowstart 60s maxconn 250 maxqueue 256 weight 100
    server server1 <master-ip1>:6443 check
    server server2 <master-ip2>:6443 check
    server server3 <master-ip3>:6443 check
```

Alternatively you can configure hostnames in `/etc/hosts` and use host names in place of IPs.

Here we are specifying some global configurations and default parameters. Then we add a `frontend` section which tells HA Proxy to bind to port `6443` on this server and specify the default `backend` where this traffic should be directed. In the `backend` section we specify the mode as `tcp` and tell it to load balance using the `roundrobin` technique. We then specify a list of servers which should be the master node addresses along with the Kube API Server port. To see more details about configuration, refer [here](https://www.haproxy.com/blog/the-four-essential-sections-of-an-haproxy-configuration/).

Once this is done we start the haproxy service:

```
systemctl start haproxy
systemctl enable haproxy
```

### Connect to the cluster through HA Proxy

Replace the server line in your Kubernetes Configuration file with the ha-proxy IP address

```
...
 certificate-authority-data: <data>
 server: https://<ha-proxy-ip>:6443
 ...
```

Now if you execute `kubectl get nodes`, you should get:

```
Unable to connect to the server: x509: certificate is valid for ha-proxy, k8-1, k8-1.cluster.local, k8-2, k8-2.cluster.local, k8-3, k8-3.cluster.local, kubernetes, kubernetes.default, kubernetes.default.svc, kubernetes.default.svc.cluster.local, lb-apiserver.kubernetes.local, localhost, not <ha-proxy-ip>
```

There are two ways to resolve this error:

- Using the `--insecure-skip-tls-verify=true` with kubectl
- Adding an entry to the api server certificate's SAN (Subject Alternative Names) entries.

The first option is easy but it does not provide the TLS protection. To use `kubectl` with TLS, follow the steps [here](https://blog.scottlowe.org/2019/07/30/adding-a-name-to-kubernetes-api-server-certificate/) on each master node.

After you configure one of the two options above, you will be able to execute `kubectl` commands.

### Install NGINX Ingress Controller

Just a brief overview about some terms:

- **Ingress** - This is the service which allows you to route requests from a domain to an internal service. So for example, you have some `ClusterIP` service running which is not accessible from outside the cluster. To expose this service you can set rules such that a request from a specific domain like `example.com` will be sent to this service.
- **Ingress Controllers** - An Ingress can't really do anything unless there is an Ingress Controller. This component is responsible for managing how the requests are routed. A list of supported Controllers can be found [here](https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/).
- **Ingress Class** - When you have multiple `IngressConrollers` deployed, there should be some way for the `Ingress` to identify which one to use. You can define `IngressClass` and point them to a specific IngressController. Then you can refer this class in the `Ingress` using the `ingressClassName` in `Ingress`

Now let's setup the NGINX Ingress Controller using HELM. Execute the next steps on the machine where you execute `kubectl` commands and have `helm` installed.

#### Add the NGINX Ingress helm repo

```
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
```

#### Create the custom values file

HELM allows us to pass some configuration to the NGINX Ingress Controller. To see all customizable options, [refer](https://github.com/kubernetes/ingress-nginx/tree/main/charts/ingress-nginx) here.

This is the sample configuration we will use which should be good enough for most cases:

```
## To have short names
fullNameOverride: nginx-controller
nameOverride: nginx-ingress

controller:
  name: controller
  containerName: controller-container

  watchIngressWithoutClass: false

  ingressClassResource:
    name: nginx-ingress
    enabled: true
    default: true
    controllerValue: "k8s.io/ingress-nginx"

  ingressClass: nginx-ingress
  service:
    type: NodePort
    nodePorts:
      http: 32080
      https: 32443
      tcp:
        8080: 32808
```

What did we do in this configuration?

- Set the controller name and the container name (important later).
- `watchIngressWithoutClass` flag tells the controller to also watch all `Ingress` which have no `ingressClassName` defined. It's a good practice to always have a particular ingress class defined so I have made it `false` but you can enable it if you want.
- We also specify the creation of an `ingressClass` which will be used by this controller. We can define more `ingressClasses` later but it's good to have one.
- Also we expose the controller service as a `NodePort` service. The controller service is where all the requests should be directed, basically our domains should point to this. If you are in a Cloud environment like EKS, you can make this `LoadBalancer` as well.

Do check the extra configurations as they include monitoring and scaling parameters as well.

### Install the Controller

```
 helm install nginx-ingress ingress-nginx/ingress-nginx --create-namespace --namespace nginx-ingress -f custom-values.yaml
```

This will setup the controller in the `nginx-ingress` namespace. To view the cluster resources:

```
kubectl get all -n nginx-ingress
```

To view the ingress class:

```
kubectl get ingressclasses.networking.k8s.io -n nginx-ingress nginx-ingress -o yaml

apiVersion: networking.k8s.io/v1
kind: IngressClass
metadata:
  annotations:
    ingressclass.kubernetes.io/is-default-class: "true"
    ...
  name: nginx-ingress
  ...
spec:
  controller: k8s.io/ingress-nginx
```

Notice the name of the class is what we defined in the `custom-values.yaml`.

### Deploying an application

Let's deploy an NGINX application that will run with the `ClusterIP` service

```
apiVersion: apps/v1
kind: Deployment
metadata:
  name: example-nginx-deployment
  namespace: nginx-ingress
spec:
  selector:
    matchLabels:
      app: nginx
  replicas: 3
  template:
    metadata:
      labels:
        app: nginx
    spec:
      containers:
        - name: nginx
          image: nginx:latest
          ports:
            - containerPort: 80

---
apiVersion: v1
kind: Service
metadata:
  name: example-nginx-app
  namespace: nginx-ingress
spec:
  selector:
    app: nginx
  type: ClusterIP
  ports:
    - name: http
      port: 80
      targetPort: 80
```

This will deploy 3 replicas of nginx pods in the `nginx-ingress` namespace. You don't specifically need to deploy in the same namespace as the controller though.

Apply this to the cluster and view the pods

```
# Apply the deployment
kubectl apply -f nginx-deployment.yaml

# View the pods
kubectl get pods -n nginx-ingress

NAME                                        READY   STATUS    RESTARTS   AGE
example-nginx-deployment-6b7f675859-6k9sb   1/1     Running   0          13s
example-nginx-deployment-6b7f675859-87ltd   1/1     Running   0          13s
example-nginx-deployment-6b7f675859-mpqh5   1/1     Running   0          13s
nginx-ingress-controller-584fcbc8cf-btcdl   1/1     Running   0          15m
```

Now this pod isn't accessible outside the cluster. To make it accessible we will deploy an ingress

```
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: eample-app-ingress
  namespace: nginx-ingress
spec:
  ingressClassName: nginx-ingress
  rules:
    - host: example-app.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: example-nginx-app
                port:
                  number: 80

```

Notice the `ingressClassName` which is the same as the `ingress class`. The ingress needs to be in the same namespace as the `ClusterIP` service in our nginx deployment. Apply this to the cluster and view status:

```
kubectl apply -f example-app-ingress.yaml

kubectl describe ing -n nginx-ingress eample-app-ingress

Name:             eample-app-ingress
Labels:           <none>
Namespace:        nginx-ingress
Address:
Ingress Class:    nginx-ingress
Default backend:  <default>
Rules:
  Host             Path  Backends
  ----             ----  --------
  example-app.com
                   /   example-nginx-app:80 (10.233.122.37:80,10.233.69.12:80,10.233.93.107:80)
Annotations:       <none>
Events:
  Type    Reason  Age   From                      Message
  ----    ------  ----  ----                      -------
  Normal  Sync    68s   nginx-ingress-controller  Scheduled for sync
```

If you get `Sync` in `Events`, everything is set. Let's the Ingress.

Add the following entry to your `/etc/hosts` file:

```
<K8 node IP> example-app.com
```

Now if you curl `http://example-app.com:32080`, you should see the nginx page html. The `32080` is the `nodePort` on which the ingress controller pod is running. You can get te services with `kubectl get svc -n nginx-ingress`.

### Accessing the service through HA Proxy

So far we accessed the application directly through one of the nodes. But since we have HA Proxy in place, let's loadbalance the traffic on the cluster for this application.

SSH into the HA Proxy server and follow these steps:

- Configure HA Proxy to watch the `/etc/haproxy/conf.d` directory for all configuration files. This allows us to divide the ha proxy configuration in multiple files, just to keep it neat.

```
# Become root
sudo su

# Edit the service
nano /lib/systemd/system/haproxy.service
```

Change the `Environment="CONFIG` to point to the `/etc/haproxy/conf.d` directory rather than `/etc/haproxy/haproxy.cfg`.

```
# Move the current file to the directory and change the name so that it is applied before other files
mkdir /etc/haproxy/conf.d
mv /etc/haproxy/haproxy.cfg /etc/haproxy/conf.d/00000default.cfg

# Reload system daemon
systemctl daemon-reload

# Restart haproxy
systemctl restart haproxy
```

Now we create a new configuration file `example-app.cfg` and paste this:

```
frontend example_app_nginx
    bind *:32080
    option tcplog
    mode tcp
    default_backend example_app_nginx_server

backend example_app_nginx_server
    mode tcp
    option tcp-check
    balance roundrobin
    option forwardfor
    http-send-name-header Host
    default-server inter 10s downinter 5s rise 2 fall 2 slowstart 60s maxconn 250 maxqueue 256 weight 100
    server server1 <master IP>:32080 check
    server server2 <worker IP>:32080 check
```

You can list the IP addresses of all your K8 nodes. HA Proxy will loadbalance all requests coming to the haproxy port `32080` to the Nginx Controller pod `32080`.

Now restart the `haproxy` service with `systemctl restart haproxy`.

Now edit the `/etc/hosts` file and change the IP Address of `example-app.com` with the HA-Proxy IP address. Now if you `curl http://example-app.com:32080`, you should receive the nginx html.

# Conclusion

We covered all the basics to setup HA Proxy with NGINX Ingress Controller on Kubernetes. Now there are a lot of ways to configure the behavious and ad dmore complexity like scaling and monitoring for a better control of your deployments. Important links to refer to:

- [NGINX Controller helm chart](https://github.com/kubernetes/ingress-nginx/tree/main/charts/ingress-nginx)
- [HA Proxy Configuration](https://www.haproxy.com/blog/the-four-essential-sections-of-an-haproxy-configuration/)
- [Kubernetes Ingress Docs](https://kubernetes.io/docs/concepts/services-networking/ingress/)
