# build a super all-in-one helicone container.  
#
# if necessary call this script with the argument --no-cache to have build go through
# the entire Dockerfile...
#

export CONTAINERD_ADDRESS=/run/k3s/containerd/containerd.sock
case ":$PATH:" in
  *:/usr/local/tmp/nerdctl/bin:*) : ;;  # already in PATH, do nothing
  *) export PATH="$PATH:/usr/local/tmp/nerdctl/bin" ;;
esac

nerdctl build "$@" -t registry.home:5000/helicone-test:latest .

if [ $? -ne 0 ]; then
  echo "Build errored out, stopping..."
  exit 1
fi

nerdctl push --insecure-registry registry.home:5000/helicone-test:latest

read -p "Do you wish to deploy to Kubernetes? (y/N): " x
if [[ "$x" == "y" || "$x" == "Y" ]]; then
  kubectl apply -f helicone.yaml
fi

