# GEMINI.md

## Project Overview

This project is a multi-component control system consisting of a central server, a web-based frontend, a main Arduino controller, and multiple Arduino-based station controllers. The system is designed to monitor and control a set of devices distributed across several stations.

### Components

*   **Server (`Server/cabane-control`):** A Node.js application using Express and Socket.IO. It acts as the central hub, managing communication with the main controller and the web frontend. It also includes a SQLite database for user management and a weather service.
*   **Frontend (`Server/frontend/cabane-ui`):** A React application built with Vite. It provides a user interface for monitoring and controlling the system. It communicates with the server via HTTP and WebSockets.
*   **Main Controller (`Main/Main_Controller`):** An Arduino Mega based controller that communicates with the server and the station controllers via UDP. It reads physical and MCP23017-based inputs, controls LEDs, and manages overall system logic.
*   **Station Controllers (`Stations/Station_Controller`):** Arduino Nano based controllers that receive commands from the main controller via UDP. They control relays and send feedback about their input states.

## Building and Running

### Frontend

To run the frontend for development:

```bash
cd "Server/frontend/cabane-ui"
npm install
npm run dev
```

To build the frontend for production:

```bash
cd "Server/frontend/cabane-ui"
npm install
npm run build
```

### Server

To run the server:

```bash
cd "Server/cabane-control"
npm install
node server.js
```

### Arduino Controllers

The Arduino code for the main and station controllers needs to be compiled and uploaded using the Arduino IDE.

*   **Main Controller:** `Main/Main_Controller/Main_Controller.ino`
*   **Station Controller:** `Stations/Station_Controller/Station_Controller.ino`

## Development Conventions

*   **Server:** The server code is written in JavaScript (Node.js). It uses a modular structure with services for different functionalities.
*   **Frontend:** The frontend code is written in JavaScript (React). It uses functional components and hooks. Tailwind CSS is used for styling.
*   **Arduino:** The Arduino code is written in C++. It is well-structured with clear separation of concerns.

## Key Files

*   `Server/cabane-control/server.js`: The main entry point for the server application.
*   `Server/frontend/cabane-ui/src/App.jsx`: The main component of the React application.
*   `Main/Main_Controller/Main_Controller.ino`: The source code for the main Arduino controller.
*   `Stations/Station_Controller/Station_Controller.ino`: The source code for the station Arduino controllers.
*   `#GEMINI.md`: This file, providing an overview of the project.
