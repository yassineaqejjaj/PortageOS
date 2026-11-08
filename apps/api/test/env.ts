process.env.JWT_SECRET = "test-secret-test-secret-test-secret-123";
process.env.APP_DATABASE_URL = process.env.APP_DATABASE_URL ?? "postgresql://portage_app:portage_app_dev@localhost:5432/portage";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://portage:portage@localhost:5432/portage";
