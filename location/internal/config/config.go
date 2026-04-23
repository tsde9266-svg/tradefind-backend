package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port       int
	RedisURL   string
	JWTSecret  []byte
}

func Load() *Config {
	port := 4000
	if p := os.Getenv("PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil {
			port = n
		}
	}

	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}

	secret := os.Getenv("JWT_SECRET")
	if secret == "" {
		panic("JWT_SECRET env var is required")
	}

	return &Config{
		Port:      port,
		RedisURL:  redisURL,
		JWTSecret: []byte(secret),
	}
}
