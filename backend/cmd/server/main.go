package main

import (
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"

	pb "github.com/entl/blockterm/gen/proto"
	"github.com/entl/blockterm/internal/suggest"
	"google.golang.org/grpc"
)

func main() {
	// Listen on a TCP port (could be unix socket in production)
	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatalf("failed to listen: %v", err)
	}

	grpcServer := grpc.NewServer()

	// Register your gRPC service implementation here
	staticSuggestions := suggest.NewStaticProvider()
	suggestionService := suggest.NewSuggestionService(staticSuggestions)
	pb.RegisterSuggestionServiceServer(grpcServer, suggestionService)

	// Graceful shutdown handling
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		log.Printf("gRPC server listening at %v", lis.Addr())
		if err := grpcServer.Serve(lis); err != nil {
			log.Fatalf("failed to serve: %v", err)
		}
	}()

	<-quit
	log.Println("Shutting down gRPC server...")
	grpcServer.GracefulStop()
	log.Println("Server stopped.")
}
