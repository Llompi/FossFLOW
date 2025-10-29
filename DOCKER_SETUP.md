# FossFLOW Docker Deployment Guide

This guide will help you deploy FossFLOW using Docker with a complete, secure infrastructure including PostgreSQL, Redis, Nginx, and monitoring tools.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [SSL/TLS Setup](#ssltls-setup)
- [Database Management](#database-management)
- [Monitoring](#monitoring)
- [Security](#security)
- [Backup and Restore](#backup-and-restore)
- [Production Deployment](#production-deployment)
- [Troubleshooting](#troubleshooting)

## Architecture Overview

The FossFLOW Docker deployment consists of the following services:

- **FossFLOW Application**: Node.js application running on port 3000
- **PostgreSQL**: Database backend with automatic initialization
- **Redis**: Session storage and caching
- **Nginx**: Reverse proxy with SSL/TLS termination
- **Prometheus**: Metrics collection and monitoring
- **Grafana**: Visualization and dashboards

All services run in an isolated Docker network with persistent volumes for data.

## Prerequisites

- Docker Engine 20.10 or later
- Docker Compose 2.0 or later
- At least 4GB RAM available
- 10GB free disk space
- (Production) A domain name pointing to your server
- (Production) Ports 80 and 443 accessible from the internet

### Install Docker

**Ubuntu/Debian:**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
```

**macOS:**
```bash
brew install docker docker-compose
```

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/FossFLOW.git
cd FossFLOW
```

### 2. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit the configuration (IMPORTANT: Change all passwords and secrets!)
nano .env
```

**Critical settings to change in `.env`:**
- `JWT_SECRET` - Use a strong random string (minimum 32 characters)
- `SESSION_SECRET` - Use a strong random string (minimum 32 characters)
- `POSTGRES_PASSWORD` - Strong database password
- `REDIS_PASSWORD` - Strong Redis password
- `GRAFANA_ADMIN_PASSWORD` - Grafana admin password

### 3. Generate SSL Certificates

**For Development (self-signed):**
```bash
./scripts/generate-certs.sh development
```

**For Production (Let's Encrypt):**
```bash
DOMAIN=yourdomain.com ./scripts/generate-certs.sh production
```

### 4. Start the Services

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Check service status
docker-compose ps
```

### 5. Access the Application

- **FossFLOW**: http://localhost (or https://yourdomain.com in production)
- **Grafana**: http://localhost:3001 (default: admin / [GRAFANA_ADMIN_PASSWORD])
- **Prometheus**: http://localhost:9090

### 6. Default Admin Login

```
Username: admin
Email: admin@fossflow.local
Password: admin123
```

**⚠️ IMPORTANT: Change the admin password immediately after first login!**

## Configuration

### Environment Variables

All configuration is done via the `.env` file. Key sections:

#### Application Settings
```env
NODE_ENV=production              # production or development
FOSSFLOW_PORT=3000              # Internal app port
DOMAIN=localhost                # Your domain name
ENABLE_HTTPS=false              # Set to true for HTTPS
ENABLE_2FA=true                 # Enable 2FA/TOTP
```

#### Security
```env
JWT_SECRET=your-secret-here     # JWT signing secret (min 32 chars)
SESSION_SECRET=your-secret-here # Session secret (min 32 chars)
```

#### Database
```env
POSTGRES_DB=fossflow
POSTGRES_USER=fossflow
POSTGRES_PASSWORD=secure-password-here
```

#### Redis
```env
REDIS_PASSWORD=secure-password-here
```

#### Rate Limiting
```env
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW_MS=900000     # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100     # Max requests per window
```

### Docker Compose Configuration

The `docker-compose.yml` file defines all services. To modify:

1. Edit service configurations
2. Rebuild: `docker-compose up -d --build`

## SSL/TLS Setup

### Development (Self-Signed Certificates)

```bash
# Generate self-signed certificates
./scripts/generate-certs.sh development

# Certificates will be created in ./certs/
# Note: Browsers will show security warnings
```

### Production (Let's Encrypt)

```bash
# Stop nginx temporarily (Let's Encrypt needs port 80)
docker-compose stop nginx

# Generate certificates
DOMAIN=yourdomain.com ./scripts/generate-certs.sh production

# Update .env
echo "ENABLE_HTTPS=true" >> .env
echo "DOMAIN=yourdomain.com" >> .env

# Restart services
docker-compose up -d
```

### Certificate Renewal

Let's Encrypt certificates expire every 90 days. Set up automatic renewal:

```bash
# Add to crontab
sudo crontab -e

# Add this line (adjust path as needed):
0 0 * * * certbot renew --deploy-hook '/path/to/FossFLOW/scripts/generate-certs.sh production-renew'
```

## Database Management

### Database Access

```bash
# Access PostgreSQL shell
docker-compose exec postgres psql -U fossflow -d fossflow

# Run SQL file
docker-compose exec -T postgres psql -U fossflow -d fossflow < backup.sql
```

### Migrations

The database schema is initialized automatically from `postgres/init/01-init.sql` on first startup.

To make schema changes:

1. Edit `postgres/init/01-init.sql` or create additional files
2. For existing databases, manually run migrations:

```bash
docker-compose exec -T postgres psql -U fossflow -d fossflow << 'SQL'
-- Your migration SQL here
SQL
```

## Monitoring

### Prometheus

Access Prometheus at http://localhost:9090

**Useful Queries:**
- CPU usage: `rate(process_cpu_seconds_total[5m])`
- Memory: `process_resident_memory_bytes`
- HTTP requests: `http_requests_total`

### Grafana

Access Grafana at http://localhost:3001

**Setup:**
1. Login with admin credentials
2. Prometheus datasource is pre-configured
3. Import dashboards from `monitoring/grafana/dashboards/`

**Pre-configured Dashboards:**
- Application metrics
- Database performance
- System resources
- Request rates and latencies

### Health Checks

```bash
# Application health
curl http://localhost:3000/health

# All services
docker-compose ps
```

## Security

### Security Features

✅ **Implemented:**
- HTTPS/TLS encryption
- Security headers (CSP, HSTS, X-Frame-Options)
- Rate limiting
- JWT authentication
- 2FA/TOTP support
- Password hashing (bcrypt)
- SQL injection protection (parameterized queries)
- CORS configuration
- Session management with Redis
- Audit logging

### Security Best Practices

1. **Change All Default Passwords**
   ```bash
   # In .env file:
   JWT_SECRET=<generate 32+ character random string>
   SESSION_SECRET=<generate 32+ character random string>
   POSTGRES_PASSWORD=<strong password>
   REDIS_PASSWORD=<strong password>
   GRAFANA_ADMIN_PASSWORD=<strong password>
   ```

2. **Use HTTPS in Production**
   ```bash
   ENABLE_HTTPS=true
   ```

3. **Enable 2FA for Admin Accounts**
   ```bash
   ENABLE_2FA=true
   ```

4. **Regular Updates**
   ```bash
   docker-compose pull
   docker-compose up -d
   ```

5. **Restrict Network Access**
   - Close unnecessary ports
   - Use firewall rules
   - Configure CORS appropriately

6. **Monitor Logs**
   ```bash
   docker-compose logs -f
   ```

### Generating Secure Secrets

```bash
# Generate random secrets (Linux/macOS)
openssl rand -base64 32

# Or using Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Backup and Restore

### Automated Backups

Backups are configured via environment variables:

```env
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *        # Daily at 2 AM
BACKUP_RETENTION_DAYS=30         # Keep 30 days
```

### Manual Backup

```bash
# Run backup script
./scripts/backup.sh

# Backups are stored in postgres/backups/
```

**Backup includes:**
- PostgreSQL database dump
- User uploads (if any)
- Configuration files

### Restore from Backup

```bash
# Stop the application
docker-compose stop fossflow

# Restore database
./scripts/restore.sh postgres/backups/fossflow_YYYY-MM-DD_HH-MM-SS.sql

# Restart services
docker-compose up -d
```

### Offsite Backups

For production, set up offsite backups:

```bash
# Example: Upload to S3
aws s3 sync postgres/backups/ s3://your-bucket/fossflow-backups/

# Or use rsync to remote server
rsync -avz postgres/backups/ user@backup-server:/backups/fossflow/
```

## Production Deployment

### Pre-Deployment Checklist

- [ ] Domain configured and DNS pointing to server
- [ ] Firewall configured (ports 80, 443, 22 only)
- [ ] SSL certificates generated
- [ ] All passwords changed in `.env`
- [ ] `NODE_ENV=production` in `.env`
- [ ] `ENABLE_HTTPS=true` in `.env`
- [ ] Admin password changed
- [ ] Backups configured
- [ ] Monitoring configured
- [ ] Email notifications configured (optional)

### Deployment Steps

```bash
# 1. Update system
sudo apt update && sudo apt upgrade -y

# 2. Clone repository
git clone https://github.com/yourusername/FossFLOW.git
cd FossFLOW

# 3. Configure environment
cp .env.example .env
nano .env  # Edit all settings

# 4. Generate SSL certificates
DOMAIN=yourdomain.com ./scripts/generate-certs.sh production

# 5. Start services
docker-compose up -d

# 6. Check logs
docker-compose logs -f

# 7. Verify health
curl https://yourdomain.com/health

# 8. Change admin password
# Login at https://yourdomain.com and change password
```

### Firewall Configuration

```bash
# Ubuntu/Debian with ufw
sudo ufw allow 22/tcp   # SSH
sudo ufw allow 80/tcp   # HTTP
sudo ufw allow 443/tcp  # HTTPS
sudo ufw enable

# Close monitoring ports (access via SSH tunnel)
# Prometheus: 9090
# Grafana: 3001
```

### Reverse Proxy (Optional)

If you already have a reverse proxy:

```bash
# Use compose.dev.yml instead
docker-compose -f compose.dev.yml up -d

# Configure your reverse proxy to forward to localhost:3000
```

## Troubleshooting

### Common Issues

#### 1. Services won't start

```bash
# Check logs
docker-compose logs

# Check disk space
df -h

# Check port conflicts
sudo netstat -tlnp | grep -E '(80|443|3000|5432|6379|9090|3001)'
```

#### 2. Database connection errors

```bash
# Check database is running
docker-compose ps postgres

# Check database logs
docker-compose logs postgres

# Test connection
docker-compose exec postgres pg_isready -U fossflow
```

#### 3. Permission issues

```bash
# Fix ownership
sudo chown -R $USER:$USER .

# Fix certificate permissions
chmod 600 certs/server.key
chmod 644 certs/server.crt
```

#### 4. SSL certificate errors

```bash
# Regenerate certificates
./scripts/generate-certs.sh development

# Check certificate validity
openssl x509 -in certs/server.crt -text -noout
```

#### 5. Out of memory

```bash
# Check memory usage
docker stats

# Increase Docker memory limit (Docker Desktop)
# Settings > Resources > Memory

# Or reduce service limits in docker-compose.yml
```

### Viewing Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f fossflow
docker-compose logs -f postgres
docker-compose logs -f nginx

# Application logs
docker-compose exec fossflow tail -f logs/combined.log
```

### Resetting Everything

```bash
# Stop and remove all containers, networks, and volumes
docker-compose down -v

# Remove generated files
rm -rf logs/ uploads/ postgres/backups/

# Start fresh
docker-compose up -d
```

## Advanced Topics

### Scaling

To run multiple FossFLOW instances:

```bash
docker-compose up -d --scale fossflow=3
```

Configure Nginx for load balancing in `nginx/conf/default.conf`.

### Custom Configuration

1. **Nginx**: Edit files in `nginx/conf/`
2. **PostgreSQL**: Edit `postgres/init/01-init.sql`
3. **Prometheus**: Edit `monitoring/prometheus/prometheus.yml`
4. **Grafana**: Edit files in `monitoring/grafana/`

After changes:
```bash
docker-compose up -d --force-recreate
```

### Development Mode

```bash
# Use development compose file
docker-compose -f compose.dev.yml up -d

# Or set in .env
NODE_ENV=development
DEBUG=true
```

## Support

- **Documentation**: [README.md](README.md)
- **Issues**: [GitHub Issues](https://github.com/yourusername/FossFLOW/issues)
- **Contributing**: [CONTRIBUTING.md](CONTRIBUTING.md)

## License

This project is licensed under the terms specified in [LICENSE](LICENSE).

---

**Last Updated**: 2025-10-29
**Version**: 1.0.0
