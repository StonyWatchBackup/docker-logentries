FROM gliderlabs/alpine

RUN apk --update add nodejs

RUN adduser -h /app -S -D -G daemon -g logentries logentries

USER logentries

WORKDIR /app

COPY package.json ./

RUN npm install --production

COPY index.js ./
COPY leapi.js ./

ENTRYPOINT ["/usr/bin/node", "/app/index.js"]
