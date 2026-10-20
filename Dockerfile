# Use an official Node.js lightweight image
FROM node:18-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package files first to install dependencies efficiently
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy the rest of your application code into the container
COPY . .

# Expose the port your server listens on (Render uses port 10000 by default or reads from process.env.PORT)
EXPOSE 10000

# Command to start your application
CMD ["node", "server.js"]
