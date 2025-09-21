# Database Setup and Management on Render (Free Tier)

This guide provides instructions for setting up and managing your PostgreSQL database on Render, specifically for users on the **Free Tier** who do not have access to the Render Shell or One-off Jobs.

## Part 1: Initial One-Time Database Setup

You only need to perform these steps **once** for your application. This process will create all your database tables and populate them with the initial data.

1.  **Connect Your Database in Render** (If not already done)
    *   Go to your Render Dashboard.
    *   Navigate to your backend service.
    *   Go to the "Environment" tab and ensure you have an environment variable `DATABASE_URL` that correctly points to your Render PostgreSQL instance.

2.  **Set the Initial Build Command**
    *   Go to your backend service's "Settings" tab in the Render Dashboard.
    *   Find the "Build & Deploy" section and locate the **Build Command**.
    *   Set the build command to the following line:
        ```
        npm install && cd apps/backend && npm run migrate:up && node ingest-data.js
        ```

3.  **Deploy the Setup**
    *   Click the "Manual Deploy" button on your service's page and select "Deploy latest commit".
    *   Monitor the deployment logs. The logs should show the dependencies being installed, the migrations running (`migrate:up`), and the data ingestion script running.
    *   This deployment may take longer than usual. Once it is successful, your database will be fully set up.

## Part 2: Ongoing Deployments & Future Changes

After the initial setup is complete, you **must** change the build command to prevent the data ingestion from running again.

1.  **Set the Final Build Command**
    *   Return to your backend service's "Settings" tab.
    *   Update the **Build Command** to the following:
        ```
        npm install && cd apps/backend && npm run migrate:up
        ```
    *   This new command ensures that every time you deploy a new version of your application, any new database migrations will be applied automatically, but it will **not** re-run the data ingestion script.

2.  **Making Future Schema Changes**
    *   When you need to change the database schema (e.g., add a column, create a new table), you will first create and commit a new migration file from your local machine.
    *   When you push your changes, the updated build command will automatically run your new migration, and your database will be updated safely.
