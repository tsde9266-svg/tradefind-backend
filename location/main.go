package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"

	"github.com/tradefind/location/internal/config"
	redisclient "github.com/tradefind/location/internal/redis"
	"github.com/tradefind/location/internal/ws"
)

func main() {
	// Honour GOMAXPROCS env — important for Hetzner 2-vCPU nodes
	if v := os.Getenv("GOMAXPROCS"); v != "" {
		if n := 0; fmt.Sscan(v, &n) == nil && n > 0 {
			runtime.GOMAXPROCS(n)
		}
	}

	cfg := config.Load()
	rdb := redisclient.NewClient(cfg.RedisURL)
	hub := ws.NewHub(rdb)
	go hub.Run()

	mux := http.NewServeMux()

	// WebSocket endpoint: ws://host:4000/ws?token=JWT[&workerId=PROFILE_ID]
	mux.HandleFunc("/ws", ws.Handler(hub, rdb, cfg.JWTSecret))

	// Health check
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"ok"}`)
	})

	addr := fmt.Sprintf("0.0.0.0:%d", cfg.Port)
	log.Printf("[location] listening on %s", addr)

	server := &http.Server{
		Addr:    addr,
		Handler: mux,
	}

	if err := server.ListenAndServe(); err != nil {
		log.Fatalf("[location] fatal: %v", err)
	}
}
