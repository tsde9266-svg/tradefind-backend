package redisclient

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

const geoKey = "workers_available"
const sessionTTL = 2 * time.Hour

func NewClient(redisURL string) *redis.Client {
	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("[redis] invalid URL: %v", err)
	}

	client := redis.NewClient(opts)

	if err := client.Ping(context.Background()).Err(); err != nil {
		log.Fatalf("[redis] ping failed: %v", err)
	}

	log.Println("[redis] connected")
	return client
}

// GeoAdd updates a worker's position in the available-workers geo sorted set.
func GeoAdd(ctx context.Context, rdb *redis.Client, workerID string, lat, lng float64) error {
	return rdb.GeoAdd(ctx, geoKey, &redis.GeoLocation{
		Name:      workerID,
		Latitude:  lat,
		Longitude: lng,
	}).Err()
}

// GeoRemove removes a worker from the available-workers geo sorted set.
func GeoRemove(ctx context.Context, rdb *redis.Client, workerID string) error {
	return rdb.ZRem(ctx, geoKey, workerID).Err()
}

// SessionTouch refreshes the worker's session TTL in Redis.
func SessionTouch(ctx context.Context, rdb *redis.Client, workerID string) {
	key := fmt.Sprintf("worker:session:%s", workerID)
	rdb.HSet(ctx, key, "lastSeen", time.Now().UnixMilli())
	rdb.Expire(ctx, key, sessionTTL)
}
