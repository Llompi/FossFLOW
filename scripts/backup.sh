#!/bin/bash
set -e

# Configuration
BACKUP_DIR="/backups"
DATE=$(date +"%Y%m%d_%H%M%S")
RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-30}

# Database configuration
DB_HOST="postgres"
DB_NAME="fossflow"
DB_USER="fossflow"
DB_PASSWORD="${POSTGRES_PASSWORD}"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to create database backup
backup_database() {
    log "Starting database backup..."
    
    local backup_file="$BACKUP_DIR/fossflow_db_$DATE.sql.gz"
    
    PGPASSWORD="$DB_PASSWORD" pg_dump \
        -h "$DB_HOST" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --no-password \
        --verbose \
        --format=custom \
        --compress=9 | gzip > "$backup_file"
    
    if [ $? -eq 0 ]; then
        log "Database backup completed: $backup_file"
        echo "$backup_file"
    else
        log "ERROR: Database backup failed"
        return 1
    fi
}

# Function to backup uploaded files
backup_files() {
    log "Starting files backup..."
    
    local backup_file="$BACKUP_DIR/fossflow_files_$DATE.tar.gz"
    local files_dir="/app/uploads"
    
    if [ -d "$files_dir" ] && [ "$(ls -A $files_dir 2>/dev/null)" ]; then
        tar -czf "$backup_file" -C "$(dirname $files_dir)" "$(basename $files_dir)"
        
        if [ $? -eq 0 ]; then
            log "Files backup completed: $backup_file"
            echo "$backup_file"
        else
            log "ERROR: Files backup failed"
            return 1
        fi
    else
        log "No files to backup in $files_dir"
    fi
}

# Function to cleanup old backups
cleanup_old_backups() {
    log "Cleaning up old backups (older than $RETENTION_DAYS days)..."
    
    find "$BACKUP_DIR" -name "fossflow_*" -type f -mtime +"$RETENTION_DAYS" -exec rm -f {} \;
    
    log "Old backups cleanup completed"
}

# Function to verify backup
verify_backup() {
    local backup_file="$1"
    
    if [ -f "$backup_file" ] && [ -s "$backup_file" ]; then
        log "Backup verification passed: $backup_file"
        return 0
    else
        log "ERROR: Backup verification failed: $backup_file"
        return 1
    fi
}

# Function to send notification (if configured)
send_notification() {
    local status="$1"
    local message="$2"
    
    if [ -n "$WEBHOOK_URL" ]; then
        curl -X POST "$WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -d "{\"text\":\"FossFLOW Backup $status: $message\"}" \
            --max-time 30 || true
    fi
    
    if [ -n "$SMTP_HOST" ] && [ -n "$NOTIFICATION_EMAIL" ]; then
        # Simple email notification (requires mailx or similar)
        echo "FossFLOW Backup $status: $message" | mail -s "FossFLOW Backup Report" "$NOTIFICATION_EMAIL" || true
    fi
}

# Main backup function
main() {
    log "Starting FossFLOW backup process..."
    
    local success=true
    local backup_files=()
    
    # Create database backup
    if db_backup=$(backup_database); then
        backup_files+=("$db_backup")
        verify_backup "$db_backup" || success=false
    else
        success=false
    fi
    
    # Create files backup
    if files_backup=$(backup_files); then
        backup_files+=("$files_backup")
        verify_backup "$files_backup" || success=false
    fi
    
    # Cleanup old backups
    cleanup_old_backups
    
    # Send notification
    if [ "$success" = true ]; then
        log "Backup process completed successfully"
        send_notification "SUCCESS" "Backup completed at $DATE. Files: ${backup_files[*]}"
    else
        log "ERROR: Backup process failed"
        send_notification "FAILED" "Backup failed at $DATE. Check logs for details."
        exit 1
    fi
}

# Run main function
main "$@"