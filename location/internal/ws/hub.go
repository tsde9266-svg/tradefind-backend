package ws

import (
	"log"
	"sync"

	"github.com/redis/go-redis/v9"
)

// Hub is the central broker. It owns all client connections and tracking rooms.
// All mutations go through the serialised Run() goroutine — no locks needed on maps.
type Hub struct {
	rdb *redis.Client

	// workers: workerId → *Client (authenticated worker connections)
	workers map[string]*Client

	// trackingRooms: workerId → set of customer *Client watching that worker
	trackingRooms map[string]map[*Client]bool

	// All clients by pointer (for cleanup)
	clients map[*Client]bool

	register   chan *Client
	unregister chan *Client

	// inbound messages from any client
	messages chan hubMsg

	mu sync.Mutex // guards nothing in maps (Run is single-threaded), used for shutdown
}

type hubMsg struct {
	client  *Client
	payload InboundMsg
}

func NewHub(rdb *redis.Client) *Hub {
	return &Hub{
		rdb:           rdb,
		workers:       make(map[string]*Client),
		trackingRooms: make(map[string]map[*Client]bool),
		clients:       make(map[*Client]bool),
		register:      make(chan *Client, 64),
		unregister:    make(chan *Client, 64),
		messages:      make(chan hubMsg, 512),
	}
}

// Run is the single event-loop goroutine. Must be called once in a goroutine.
func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.clients[c] = true
			if c.role == "worker" && c.workerID != "" {
				h.workers[c.workerID] = c
				log.Printf("[hub] worker connected: %s", c.workerID)
			}

		case c := <-h.unregister:
			if _, ok := h.clients[c]; !ok {
				continue
			}
			delete(h.clients, c)
			close(c.send)

			if c.role == "worker" && c.workerID != "" {
				if h.workers[c.workerID] == c {
					delete(h.workers, c.workerID)
				}
				// Remove from Redis and notify any tracking customers
				go func(wid string) {
					if err := geoRemove(h.rdb, wid); err != nil {
						log.Printf("[hub] geoRemove error: %v", err)
					}
				}(c.workerID)

				h.broadcastToRoom(c.workerID, OutboundMsg{Type: "worker:offline"})
				log.Printf("[hub] worker disconnected: %s", c.workerID)
			}

			// Remove this client from all tracking rooms it joined
			for wid, room := range h.trackingRooms {
				delete(room, c)
				if len(room) == 0 {
					delete(h.trackingRooms, wid)
				}
			}

		case m := <-h.messages:
			h.handleMessage(m.client, m.payload)
		}
	}
}

func (h *Hub) handleMessage(c *Client, msg InboundMsg) {
	switch msg.Type {
	case "location:update":
		if c.role != "worker" || c.workerID == "" {
			return
		}
		// Update Redis geo position
		go func() {
			if err := geoAdd(h.rdb, c.workerID, msg.Lat, msg.Lng); err != nil {
				log.Printf("[hub] geoAdd error: %v", err)
			}
			sessionTouch(h.rdb, c.workerID)
		}()
		// Broadcast to all tracking customers
		h.broadcastToRoom(c.workerID, OutboundMsg{Type: "worker:moved", Lat: msg.Lat, Lng: msg.Lng})

	case "worker:offline":
		if c.role != "worker" || c.workerID == "" {
			return
		}
		go func() {
			geoRemove(h.rdb, c.workerID) //nolint
		}()
		h.broadcastToRoom(c.workerID, OutboundMsg{Type: "worker:offline"})

	case "track:start":
		if c.role != "customer" || msg.WorkerID == "" {
			return
		}
		if h.trackingRooms[msg.WorkerID] == nil {
			h.trackingRooms[msg.WorkerID] = make(map[*Client]bool)
		}
		h.trackingRooms[msg.WorkerID][c] = true
		log.Printf("[hub] customer tracking worker %s", msg.WorkerID)

	case "track:stop":
		if msg.WorkerID == "" {
			return
		}
		if room, ok := h.trackingRooms[msg.WorkerID]; ok {
			delete(room, c)
			if len(room) == 0 {
				delete(h.trackingRooms, msg.WorkerID)
			}
		}
	}
}

func (h *Hub) broadcastToRoom(workerID string, msg OutboundMsg) {
	room, ok := h.trackingRooms[workerID]
	if !ok || len(room) == 0 {
		return
	}
	data := marshalMsg(msg)
	for c := range room {
		select {
		case c.send <- data:
		default:
			// Client send buffer full — drop message
		}
	}
}
