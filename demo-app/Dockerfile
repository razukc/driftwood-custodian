# Cloud Run image for the driftwood-inventory demo app (the monitored fiction
# the agent investigates and rolls back). Express v5 + OTel logs → Dynatrace.
FROM node:22-slim

WORKDIR /app

# Install production deps from the lockfile (reproducible).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

# Cloud Run routes to 0.0.0.0:$PORT; main.js honors both via env.
ENV HOST=0.0.0.0
EXPOSE 8080

# Not `npm start` — that uses --env-file=.env, which isn't in the image
# (env + secrets are injected by Cloud Run).
CMD ["node", "src/main.js"]
