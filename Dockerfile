FROM mcr.microsoft.com/playwright:focal
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY crawler.js ./
EXPOSE 3000
CMD ["node", "crawler.js"]
