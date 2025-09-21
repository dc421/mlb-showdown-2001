# Database Setup and Management on Render

This guide provides instructions for setting up and managing your PostgreSQL database on Render.

## One-Time Setup

You only need to perform these steps once for your application.

### 1. Connect Your Database in Render

1.  Go to your Render Dashboard.
2.  Navigate to your backend service (the one using this code).
3.  Go to the "Environment" tab.
4.  Click "Add Environment Group" or "Add Secret File" and connect the environment group that contains the `DATABASE_URL` from your Render PostgreSQL instance. Render automatically creates this for you when you create a database. Make sure your backend service and your database are in the same region for the best performance.

### 2. Initial Database Migration and Data Ingestion

You need to run the initial setup commands from the Render Shell.

1.  Go to your backend service in the Render Dashboard.
2.  Click on the "Shell" tab to open a terminal session.
3.  Wait for the shell to connect. Your code is located in the `/usr/src/app` directory.
4.  Run the following commands one by one:

    ```bash
    # Navigate to the backend directory
    cd apps/backend

    # Install dependencies (if not already done by the build command)
    npm install

    # Run the database migration to create all tables
    npm run migrate:up

    # Run the script to populate the 'cards_player' table
    node ingest-data.js
    ```

After these commands complete successfully, your database will be fully set up and populated with the initial player card data.

## Ongoing Deployments & Future Changes

### Automatic Migrations

To ensure your database schema is always up-to-date with your code, you should add the migration command to your service's **Build Command** in Render.

1.  Go to your backend service's "Settings" tab in the Render Dashboard.
2.  Find the "Build & Deploy" section.
3.  Your Build Command is likely `npm install` or similar. You should add the migration command to run *after* dependencies are installed. A good build command would be:

    ```
    npm install && cd apps/backend && npm run migrate:up
    ```
    *Note: Adjust the `cd apps/backend` part if your root directory is configured differently in Render.*

    This command ensures that every time you deploy a new version of your application, any new database migrations will be applied automatically.

### Making Future Schema Changes

When you need to change the database schema in the future (e.g., add a column, create a new table):

1.  **Create a new migration file locally:**
    ```bash
    # From your local machine, in the apps/backend directory
    npm run migrate:create -- --name your-descriptive-migration-name
    ```
2.  **Edit the new migration file:** Add your `pgm.addColumn()`, `pgm.createTable()`, etc. calls to the `up` function, and the corresponding `down` calls.
3.  **Commit and push the new migration file** to your Git repository.
4.  **Deploy your application on Render.** The updated Build Command will automatically run your new migration, and your database will be updated.

This workflow provides a safe and reliable way to evolve your database schema over time.
