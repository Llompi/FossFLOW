#!/bin/bash

###############################################################################
# SSL Certificate Generation Script for FossFLOW
#
# This script generates self-signed SSL certificates for development/testing
# or helps set up Let's Encrypt certificates for production.
#
# Usage:
#   ./scripts/generate-certs.sh [development|production]
###############################################################################

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
CERT_DIR="./certs"
DOMAIN="${DOMAIN:-localhost}"
MODE="${1:-development}"

echo -e "${GREEN}FossFLOW SSL Certificate Generator${NC}"
echo "====================================="
echo ""

# Create certs directory if it doesn't exist
mkdir -p "$CERT_DIR"

if [ "$MODE" = "development" ]; then
    echo -e "${YELLOW}Generating self-signed certificates for development...${NC}"
    echo ""

    # Generate self-signed certificate
    openssl req -x509 \
        -nodes \
        -days 365 \
        -newkey rsa:2048 \
        -keyout "$CERT_DIR/server.key" \
        -out "$CERT_DIR/server.crt" \
        -subj "/C=US/ST=State/L=City/O=FossFLOW/OU=Development/CN=$DOMAIN" \
        -addext "subjectAltName=DNS:$DOMAIN,DNS:localhost,IP:127.0.0.1"

    # Set appropriate permissions
    chmod 600 "$CERT_DIR/server.key"
    chmod 644 "$CERT_DIR/server.crt"

    echo ""
    echo -e "${GREEN}✓ Self-signed certificates generated successfully!${NC}"
    echo ""
    echo "Certificate files created:"
    echo "  - $CERT_DIR/server.crt (Certificate)"
    echo "  - $CERT_DIR/server.key (Private Key)"
    echo ""
    echo -e "${YELLOW}⚠ WARNING: These are self-signed certificates for development only!${NC}"
    echo -e "${YELLOW}⚠ Browsers will show security warnings. Do NOT use in production.${NC}"
    echo ""

elif [ "$MODE" = "production" ]; then
    echo -e "${YELLOW}Setting up Let's Encrypt certificates for production...${NC}"
    echo ""

    # Check if certbot is installed
    if ! command -v certbot &> /dev/null; then
        echo -e "${RED}Error: certbot is not installed.${NC}"
        echo ""
        echo "Please install certbot first:"
        echo "  Ubuntu/Debian: sudo apt-get install certbot"
        echo "  CentOS/RHEL:   sudo yum install certbot"
        echo "  macOS:         brew install certbot"
        echo ""
        exit 1
    fi

    # Check if domain is set
    if [ "$DOMAIN" = "localhost" ]; then
        echo -e "${RED}Error: DOMAIN environment variable must be set for production.${NC}"
        echo ""
        echo "Usage: DOMAIN=yourdomain.com ./scripts/generate-certs.sh production"
        echo ""
        exit 1
    fi

    # Prompt for email
    read -p "Enter email for Let's Encrypt notifications: " EMAIL

    if [ -z "$EMAIL" ]; then
        echo -e "${RED}Error: Email is required for Let's Encrypt.${NC}"
        exit 1
    fi

    echo ""
    echo "Generating Let's Encrypt certificate for: $DOMAIN"
    echo "Email: $EMAIL"
    echo ""
    echo -e "${YELLOW}Note: This requires port 80 to be accessible from the internet.${NC}"
    echo ""

    read -p "Continue? (y/n) " -n 1 -r
    echo ""

    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Cancelled."
        exit 0
    fi

    # Run certbot
    sudo certbot certonly \
        --standalone \
        --preferred-challenges http \
        -d "$DOMAIN" \
        --email "$EMAIL" \
        --agree-tos \
        --non-interactive

    # Copy certificates to certs directory
    sudo cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$CERT_DIR/server.crt"
    sudo cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$CERT_DIR/server.key"

    # Set ownership and permissions
    sudo chown $USER:$USER "$CERT_DIR/server.crt" "$CERT_DIR/server.key"
    chmod 600 "$CERT_DIR/server.key"
    chmod 644 "$CERT_DIR/server.crt"

    echo ""
    echo -e "${GREEN}✓ Let's Encrypt certificates installed successfully!${NC}"
    echo ""
    echo "Certificate files:"
    echo "  - $CERT_DIR/server.crt (Certificate)"
    echo "  - $CERT_DIR/server.key (Private Key)"
    echo ""
    echo -e "${YELLOW}Note: Certificates will expire in 90 days.${NC}"
    echo "Set up automatic renewal with:"
    echo "  sudo certbot renew --deploy-hook './scripts/generate-certs.sh production-renew'"
    echo ""

elif [ "$MODE" = "production-renew" ]; then
    # This mode is called by certbot's deploy hook
    echo -e "${YELLOW}Renewing Let's Encrypt certificates...${NC}"

    sudo cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$CERT_DIR/server.crt"
    sudo cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$CERT_DIR/server.key"

    sudo chown $USER:$USER "$CERT_DIR/server.crt" "$CERT_DIR/server.key"
    chmod 600 "$CERT_DIR/server.key"
    chmod 644 "$CERT_DIR/server.crt"

    # Reload nginx if running in Docker
    docker-compose restart nginx 2>/dev/null || true

    echo -e "${GREEN}✓ Certificates renewed and services reloaded!${NC}"

else
    echo -e "${RED}Error: Invalid mode '$MODE'${NC}"
    echo ""
    echo "Usage: $0 [development|production]"
    echo ""
    echo "Modes:"
    echo "  development - Generate self-signed certificates for local testing"
    echo "  production  - Set up Let's Encrypt certificates for production"
    echo ""
    exit 1
fi

# Create a README in the certs directory
cat > "$CERT_DIR/README.md" << 'EOF'
# SSL Certificates

This directory contains SSL/TLS certificates for FossFLOW.

## Files

- `server.crt` - SSL certificate
- `server.key` - Private key (keep this secure!)

## Security Notes

1. **Never commit these files to git** - they are in .gitignore
2. **Keep the private key secure** - it should only be readable by the application
3. **Rotate certificates regularly** - especially in production

## Development

Self-signed certificates are generated using:
```bash
./scripts/generate-certs.sh development
```

## Production

Let's Encrypt certificates are set up using:
```bash
DOMAIN=yourdomain.com ./scripts/generate-certs.sh production
```

Certificates expire after 90 days. Set up automatic renewal:
```bash
sudo crontab -e
# Add this line to renew daily:
0 0 * * * certbot renew --deploy-hook '/path/to/scripts/generate-certs.sh production-renew'
```
EOF

echo "Created README in $CERT_DIR/README.md"
echo ""
echo -e "${GREEN}Done!${NC}"
