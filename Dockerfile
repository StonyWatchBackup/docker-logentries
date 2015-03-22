FROM gliderlabs/alpine

RUN apk --update add nodejs

RUN mkdir -p /app

COPY package.json /app/

WORKDIR /app

RUN npm install --production

RUN adduser -H -S -D -G daemon logentries

USER logentries

COPY index.js /app/
COPY leapi.js /app/

CMD ["/app/index.js"]
