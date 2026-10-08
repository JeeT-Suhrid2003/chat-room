# Small Room

A small realtime chat room split across three containers: Nginx serves the frontend, Node.js and Socket.IO handle chat, and PostgreSQL stores message history.

## Run with Docker Compose

Requires Docker with the Compose plugin.

```sh
docker compose up --build
```

Open http://localhost:8080. Compose starts the frontend, backend, and database separately. Chat history persists in the `chat-data` volume.

The included database password is for local development only. Change it before deploying this app publicly.

The backend health endpoint is available at http://localhost:8080/health.

## Deploy to Kubernetes

Build the two app images and make them available to your cluster. For a local Kind cluster, load the images after building:

```sh
docker build -t small-room-backend:latest .
docker build -f frontend/Dockerfile -t small-room-frontend:latest .
kind load docker-image small-room-backend:latest small-room-frontend:latest
kubectl apply -f k8s/secret.yml -f k8s/pcv.yml -f k8s/deployment.yml -f k8s/service.yaml
```

For another cluster, push the images to a registry and update the image names in `k8s/deployment.yml`. The frontend is exposed by a `NodePort` service on port `30080`; alternatively, use `kubectl port-forward service/frontend 8080:80` and open http://localhost:8080. The database uses a 1 GiB persistent volume claim defined in `k8s/pcv.yml`, so the cluster needs a default StorageClass or a matching PersistentVolume.

The manifest's database password is for local development only. Replace it before deploying publicly.