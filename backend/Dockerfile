# Use an official lightweight Node.js image as the base
FROM node:20-slim

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json first.
COPY package.json package-lock.json ./

# 1. Run NPM CI for all general dependencies
RUN npm install --legacy-peer-deps

# 2. FIX APPLIED: Explicitly ensure the problematic scoped package is installed and available.
RUN npm install @neynar/nodejs-sdk --prefix /app --no-save

# Copy the rest of the application code (including index.js) to the working directory.
COPY . .

# Cloud Run expects the service to listen on the port specified by the PORT environment variable.
ENV PORT 8080

# Command to run the application.
CMD ["node", "index.js"]