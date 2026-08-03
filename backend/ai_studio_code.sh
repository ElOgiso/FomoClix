# View real-time log outputs of your running bot
pm2 logs trading-bot

# Check process list status and memory consumption
pm2 list

# Verify the backend health endpoint externally via Terminal
curl -i https://api.yourdomain.com/

# Restart Nginx or PM2 process after configuration updates
pm2 restart trading-bot
sudo systemctl restart nginx