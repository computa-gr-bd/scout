"""Tests never connect to the configured Neon production database."""
import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["FOOTBALL_DATA_TOKEN"] = ""
os.environ["ENVIRONMENT"] = "test"
os.environ["SECRET_KEY"] = "test-only-not-for-production"
