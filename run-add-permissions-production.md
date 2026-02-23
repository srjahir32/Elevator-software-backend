# How to Run AMC Permissions Script on Live Server

## Method 1: Using Environment Variable (Recommended)

```bash
# Set production database URI and run
DB_URI="mongodb://your-production-connection-string" node addAMCPermissions.js
```

## Method 2: Using .env File

1. Make sure your `.env` file on the live server has:
   ```
   DB_URI=your-production-mongodb-connection-string
   ```

2. Run the script:
   ```bash
   node addAMCPermissions.js
   ```
   OR
   ```bash
   npm run add-amc-permissions
   ```

## Method 3: SSH into Live Server

If you're using SSH to access your live server:

```bash
# SSH into your server
ssh user@your-server-ip

# Navigate to backend directory
cd /path/to/Elevator-software-backend

# Run the script
node addAMCPermissions.js
```

## Important Notes:

- ⚠️ **Backup your database** before running on production
- The script is **idempotent** - safe to run multiple times
- It will only add permissions if they don't already exist
- All permissions will be assigned to Admin role (role_id: 1)

## Verification:

After running, verify in your database:
- Check `permissions` collection for AMC permissions (IDs: 80, 81, 82, 83)
- Check `role_with_permissions` collection for Admin role assignments

