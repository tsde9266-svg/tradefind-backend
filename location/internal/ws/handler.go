package ws

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"
	tfauth "github.com/tradefind/location/internal/auth"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allow all origins — this is a mobile app, not a browser
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Handler upgrades HTTP → WebSocket, validates JWT, then pumps messages.
func Handler(hub *Hub, rdb *redis.Client, jwtSecret []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Validate token from query param: /ws?token=JWT
		token := r.URL.Query().Get("token")
		if token == "" {
			http.Error(w, "token required", http.StatusUnauthorized)
			return
		}

		claims, err := tfauth.ValidateToken(token, jwtSecret)
		if err != nil {
			http.Error(w, "invalid token", http.StatusUnauthorized)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("[ws] upgrade error: %v", err)
			return
		}

		client := &Client{
			hub:    hub,
			conn:   conn,
			send:   make(chan []byte, 256),
			userID: claims.UserID,
			role:   claims.Role,
		}

		// For worker clients, resolve their WorkerProfile.id from Redis session
		if claims.Role == "worker" {
			wid, err := resolveWorkerID(r.Context(), rdb, claims.UserID)
			if err != nil {
				// Worker profile ID not in Redis session — send it as a query param fallback
				wid = r.URL.Query().Get("workerId")
			}
			if wid == "" {
				conn.WriteMessage(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, "workerId required"))
				conn.Close()
				return
			}
			client.workerID = wid
		}

		hub.register <- client

		// Send welcome
		client.send <- marshalMsg(OutboundMsg{Type: "connected"})

		go client.WritePump()
		go client.ReadPump()
	}
}

// resolveWorkerID looks up the worker profile ID from the Redis session hash.
// The session key is written by the Node.js API when the worker goes available.
func resolveWorkerID(ctx context.Context, rdb *redis.Client, userID string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()

	key := fmt.Sprintf("worker:session:%s", userID)
	val, err := rdb.HGet(ctx, key, "workerId").Result()
	if err != nil {
		return "", err
	}
	return val, nil
}

// Internal Redis helpers called from hub.go without importing the redis package again.
func geoAdd(rdb *redis.Client, workerID string, lat, lng float64) error {
	return rdb.GeoAdd(context.Background(), "workers_available", &redis.GeoLocation{
		Name: workerID, Latitude: lat, Longitude: lng,
	}).Err()
}

func geoRemove(rdb *redis.Client, workerID string) error {
	return rdb.ZRem(context.Background(), "workers_available", workerID).Err()
}

func sessionTouch(rdb *redis.Client, workerID string) {
	key := fmt.Sprintf("worker:session:%s", workerID)
	rdb.HSet(context.Background(), key, "lastSeen", time.Now().UnixMilli())
	rdb.Expire(context.Background(), key, 2*time.Hour)
}
