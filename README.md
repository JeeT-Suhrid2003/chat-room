# Small Room

A small realtime chat room: Nginx serves the frontend, Node.js and Socket.IO handle chat, and PostgreSQL stores message history. Grafana Alloy collects container logs into Loki, which you can explore in Grafana.

Each chat connection is recorded in the PostgreSQL `chat_user_sessions` table, including its username, connection time, last activity, and disconnection time. To list active users, query sessions with `disconnected_at IS NULL` and a `last_seen_at` within the last 45 seconds. The backend refreshes active sessions every 15 seconds and marks sessions disconnected after they stop refreshing, so sessions left behind by a crashed pod are eventually closed. Multiple connections using the same display name appear as separate sessions.

## Run with Docker Compose

Requires Docker with the Compose plugin.

```sh
docker compose up --build
```

Open http://localhost:8080 for the chat room and http://localhost:3001 for Grafana. Sign in to Grafana with `admin` / `admin` by default; set `GRAFANA_ADMIN_PASSWORD` before starting Compose to use a different password. In Grafana, open **Explore**, select the Loki data source, and try `{job="docker"}`. To view backend JSON logs, use `{job="docker", container=~".*backend.*"} | json`; filter for `event="http.request"`, `event="chat.user_connected"`, `event="chat.user_disconnected"`, `event="chat.user_joined"`, or `event="chat.message_sent"` to inspect HTTP requests and chat activity. Nginx access logs are available with `{job="docker", container=~".*frontend.*"}`.

Chat message bodies are not written to logs. Message events include metadata such as sender and text length only. Grafana persists its data in the `grafana-data` volume, and Loki stores logs in `loki-data`; chat history persists in `chat-data`. Alloy reads container logs via the Docker socket, and Loki is only reachable by other Compose services. These observability services are configured for local Docker Compose, not the Kubernetes manifests.

The included database password and default Grafana password are for local development only. Change them before deploying this app publicly.

The backend health endpoint is available at http://localhost:8080/health.

## Run a stress test

Install [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/), make sure the application is reachable at the URL configured in `stress-test.js`, then run:

```sh
k6 run stress-test.js
```

The script ramps up to 50 virtual users, then to 100, and takes about 16 minutes. It requires HTTP requests to succeed at least 99% of the time and the 95th-percentile request duration to stay below 500 ms. For the recorded run and its results, see [stress-test-results.md](./stress-test-results.md).

## Deploy to Kubernetes

Build the two app images and make them available to your cluster. For a local Kind cluster, load the images after building:

```sh
docker build -t small-room-backend:latest .
docker build -f frontend/Dockerfile -t small-room-frontend:latest .
kind load docker-image small-room-backend:latest small-room-frontend:latest
kubectl apply -f k8s/secret.yml -f k8s/pcv.yml -f k8s/deployment.yml -f k8s/service.yaml -f k8s/ingress.yml
```

For another cluster, push the images to a registry and update the image names in `k8s/deployment.yml`. The database uses a 1 GiB persistent volume claim defined in `k8s/pcv.yml`, so the cluster needs a default StorageClass or a matching PersistentVolume.

The frontend Service is `ClusterIP`. To use `frontend.small-room.local` from `stress-test.js`, the cluster needs an Ingress controller that handles the `nginx` IngressClass, and the hostname must resolve to that controller. Without an Ingress controller, use `kubectl port-forward service/frontend 8080:80` and set the URL in `stress-test.js` to `http://localhost:8080/` before running the test.

The manifest's database password is for local development only. Replace it before deploying publicly.

For an existing Kind deployment, rebuild and load the updated backend image, then restart the backend so the session table is created:

```sh
docker build -t small-room-backend:latest .
kind load docker-image small-room-backend:latest
kubectl rollout restart deployment/backend
kubectl rollout status deployment/backend
```

To inspect active sessions in Kubernetes, run:

```sh
kubectl exec -it deployment/database -- psql -U chatroom -d chatroom
```

Then query current users:

```sql
SELECT username, connected_at, last_seen_at
FROM chat_user_sessions
WHERE disconnected_at IS NULL
  AND last_seen_at >= NOW() - INTERVAL '45 seconds'
ORDER BY connected_at;
```

To view connection history, query `username`, `connected_at`, and `disconnected_at` from `chat_user_sessions`.