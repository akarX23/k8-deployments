# Spark Operator setup on K8s
This guide explains how you can deploy the spark operator for Kubernetes and the important configurations to know about it while deploying. If you want to read in detail from the developers themselves, click [here](https://github.com/GoogleCloudPlatform/spark-on-k8s-operator).
## Setup of Spark Operator
The operator is installed using helm. We pass a `custom-values.yml` file to helm to configure the Operator with the available options. To check out the list of available options  click [here](https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/tree/master/charts/spark-operator-chart#values).

### Add the repository
```
helm repo add spark-operator https://googlecloudplatform.github.io/spark-on-k8s-operator
```
### Important chart values

Before we install the chart let's look at the important configuration options we should know about:
- `controllerThreads`: Integer value, more the threads better is performance but increases memory usage.
- `metrics.enable`: Enable prometheus metric scraping. Defaults to 	`true`.
- `replicaCount`: No. of spark operator pods
- `resources`: Resource configuration for the spark operator pods
-  `sparkJobNamespace`: This is the name space in which the spark operator will track the Spark Applications. Basically, any SparkApplication deployed outside this namespace will not be deployed on the spark operator. If this is left empty then spark operator will detect all applications in all namespaces. Read more [here](https://googlecloudplatform.github.io/spark-on-k8s-operator/docs/quick-start-guide.html#about-the-spark-job-namespace).
- `uiService.enable`: Default true. Tells spark to deploy the Spark UI for the spark applications. Read more about this [here](https://googlecloudplatform.github.io/spark-on-k8s-operator/docs/quick-start-guide.html#driver-ui-access-and-ingress).
### Install the operator
After you have created the `custom-values.yaml` file it is time to install the operator:
```
helm install --create-namespace -n spark-operator my-release spark-operator/spark-operator -f custom-values.yaml
```
This will install all the resources in the `spark-operator` namespace. It will create the namespace if it doesn't exist.
## SparkApplication CRD
The operator installs a custom resource definition (CRD) called SparkApplication. This is what we will use to submit a spark application to the operator. The operator keeps on listening to see if a new SparkApplication has been initiated or not. The spark application needs to be deployed in the namespace specified in the `sparkJobNamespace` for the spark operator to pick it up and process it.
It's very important to understand all the configuration provided by the SparkApplication CRD . An entire list of configuration options can be found [here](https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/blob/master/docs/api-docs.md#sparkoperator.k8s.io/v1beta2.SparkApplication) along with their description.

There are some examples provided in the spark operator repository [here](https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/tree/master/examples). Here is a simple SparkApplication configuration:
```
apiVersion: "sparkoperator.k8s.io/v1beta2"
kind: SparkApplication
metadata:
  name: pyspark-pi
  namespace: spark-jobs
spec:
  type: Python
  pythonVersion: "3"
  mode: cluster
  image: "gcr.io/spark-operator/spark-py:v3.1.1"
  imagePullPolicy: Always
  mainApplicationFile: local:///opt/spark/examples/src/main/python/pi.py
  sparkVersion: "3.1.1"
  restartPolicy:
    type: OnFailure
    onFailureRetries: 3
    onFailureRetryInterval: 10
    onSubmissionFailureRetries: 5
    onSubmissionFailureRetryInterval: 20
  driver:
    cores: 1
    coreLimit: "1200m"
    memory: "512m"
    labels:
      version: 3.1.1
    serviceAccount: spark
  executor:
    cores: 1
    instances: 1
    memory: "512m"
    labels:
      version: 3.1.1
```
Note the `apiVersion`, `kind` and `metadata.namespace` fields above. The `namespace` field needs to match with the `sparkJobNamespace` provided while configuring the operator. Your application needs to be uploaded to a docker image in an online repository like DockerHub which can be pulled by Kubernetes. The `mainApplicaitonFile` needs to point to the location of the file where the actual spark code is stored. The operator will submit this file to the spark driver and the operator pods will process the code. The `driver` and `executor` pods are the ones which will actually process the file so it's recommended to specify the resources for them. 
### Metrics
The spark operator provides options to configure export of metrics for the applications as well as the spark operator itself. Detailed guide on monitoring can be found [here](https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/blob/master/docs/user-guide.md#monitoring).
### Dynamic Allocation
Spark Operator provides configuration for scaling the workload on multiple executor pods based on the load. This can be enabled via the `dynamicAllocation` key in the `SparkApplication` yaml file. The configuration object can be found [here](https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/blob/master/docs/api-docs.md#dynamicallocation).

# Conclusion
This is most of the important things to explore about spark operator. Important links to refer to when using spark operator:
- [Spark Operator helm chart](https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/tree/master/charts/spark-operator-chart#spark-operator)
- [Complete User guide to using the operator](https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/blob/master/docs/user-guide.md#user-guide)
- [Spark Application CRD](https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/blob/master/docs/api-docs.md#sparkoperator.k8s.io/v1beta2.SparkApplication)
- [Some examples for various configurations](https://github.com/GoogleCloudPlatform/spark-on-k8s-operator/tree/master/examples)

Please contact me if there are any changes required or if you have any doubts. Thank you!
