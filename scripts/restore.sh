#!/bin/bash
set -e

# Configuration
BACKUP_DIR="/backups"
DB_HOST="postgres"
DB_NAME="fossflow"
DB_USER="fossflow"
DB_PASSWORD="${POSTGRES_PASSWORD}"

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to list available backups
list_backups() {
    log "Available database backups:"
    ls -la "$BACKUP_DIR"/fossflow_db_*.sql.gz 2>/dev/null || log "No database backups found"
    
    log "Available file backups:"
    ls -la "$BACKUP_DIR"/fossflow_files_*.tar.gz 2>/dev/null || log "No file backups found"
}

# Function to restore database
restore_database() {
    local backup_file="$1"
    
    if [ ! -f "$backup_file" ]; then
        log "ERROR: Backup file not found: $backup_file"
        return 1
    fi
    
    log "Restoring database from: $backup_file"
    
    # Drop existing database and recreate
    PGPASSWORD="$DB_PASSWORD" dropdb -h "$DB_HOST" -U "$DB_USER" "$DB_NAME" --if-exists
    PGPASSWORD="$DB_PASSWORD" createdb -h "$DB_HOST" -U "$DB_USER" "$DB_NAME"
    
    # Restore from backup
    gunzip -c "$backup_file" | PGPASSWORD="$DB_PASSWORD" pg_restore \
        -h "$DB_HOST" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --no-password \
        --verbose
    
    if [ $? -eq 0 ]; then
        log "Database restore completed successfully"
    else
        log "ERROR: Database restore failed"
        return 1
    fi
}

# Function to restore files
restore_files() {
    local backup_file="$1"
    local target_dir="/app/uploads"
    
    if [ ! -f "$backup_file" ]; then
        log "ERROR: Backup file not found: $backup_file"
        return 1
    fi
    
    log "Restoring files from: $backup_file"
    
    # Create target directory if it doesn't exist
    mkdir -p "$(dirname $target_dir)"
    
    # Remove existing files
    rm -rf "$target_dir"
    
    # Extract backup
    tar -xzf "$backup_file" -C "$(dirname $target_dir)"
    
    if [ $? -eq 0 ]; then
        log "Files restore completed successfully"
    else
        log "ERROR: Files restore failed"
        return 1
    fi
}

# Main function
main() {
    local db_backup="$1"
    local files_backup="$2"
    
    if [ $# -eq 0 ]; then
        echo "Usage: $0 <database_backup> [files_backup]"
        echo "       $0 --list"
        echo ""
        echo "Examples:"
        echo "  $0 /backups/fossflow_db_20231028_120000.sql.gz"
        echo "  $0 /backups/fossflow_db_20231028_120000.sql.gz /backups/fossflow_files_20231028_120000.tar.gz"
        echo "  $0 --list"
        exit 1
    fi
    
    if [ "$1" = "--list" ]; then
        list_backups
        exit 0
    fi
    
    log "Starting FossFLOW restore process..."
    
    # Restore database
    if [ -n "$db_backup" ]; then
        restore_database "$db_backup"
    fi
    
    # Restore files if specified
    if [ -n "$files_backup" ]; then
        restore_files "$files_backup"
    fi
    
    log "Restore process completed"
}

# Run main function
main "$@"