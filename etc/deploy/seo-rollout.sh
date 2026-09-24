#!/bin/sh
set -eu
image="${1:?Pass the verified Sitelytics image tag or digest}"
cd "$(dirname "$0")"
kubectl --context tgs -n utils set image deployment/sitelytics "sitelytics=$image"
kubectl --context tgs -n utils patch deployment sitelytics --type strategic --patch '{"spec":{"template":{"spec":{"containers":[{"name":"sitelytics","resources":{"requests":{"cpu":"100m","memory":"128Mi"},"limits":{"cpu":"1","memory":"512Mi"}},"readinessProbe":{"httpGet":{"path":"/api/health","port":19000}}}]}}}}'
kubectl --context tgs -n utils rollout status deployment/sitelytics --timeout=180s
kubectl --context tgs set image --local -f seo-worker.yaml "worker=$image" -o yaml | kubectl --context tgs apply -f -
kubectl --context tgs -n utils rollout status deployment/sitelytics-seo-worker --timeout=180s
