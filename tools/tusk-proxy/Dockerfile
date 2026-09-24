# Tusk proxy for Cerberus AI. Zero dependencies, Node 20.
FROM node:20-alpine

WORKDIR /app

# The proxy has no dependencies, so there is no npm install step.
COPY server.mjs models.json ./

ENV NODE_ENV=production
ENV PORT=8787
# Bind all interfaces so the container is reachable behind the host's router.
ENV HOST=0.0.0.0
# Lock this down in production: ALLOW_ORIGIN=https://your-site.example
ENV ALLOW_ORIGIN=*

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
