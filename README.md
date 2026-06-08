# mav-console Dashboard

Custom React + Apache ECharts dashboard for Maverick local AI operations, homelab health, and client automation monitoring.

It uses Prometheus as the data source and keeps Grafana out of the visual layer.

## Local Development

```powershell
npm install
npm run dev -- --port 3010
```

Open:

```text
http://localhost:3010
```

## Production

```powershell
npm run build
$env:PROMETHEUS_URL='http://192.168.1.12:9090'
$env:LLAMA_SERVER_URL='http://192.168.1.10:8080'
npm start
```

The dashboard polls `LLAMA_SERVER_URL` through `/api/llm/status` and displays the currently loaded local model in the top bar and Local AI Core panel.

## Container

```bash
docker compose up -d --build
```

The app listens on port `3010`.
