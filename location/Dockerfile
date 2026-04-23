FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o location-server .

FROM scratch
COPY --from=builder /app/location-server /location-server
EXPOSE 4000
ENTRYPOINT ["/location-server"]
