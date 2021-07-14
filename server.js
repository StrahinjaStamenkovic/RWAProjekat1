const express = require("express");
const app = express();
const http = require("http").Server(app);
const io = require("socket.io");
const PORT = process.env.PORT || 3000;

const { of, fromEvent } = require("rxjs");
const {
  map,
  mapTo,
  switchMap,
  mergeMap,
  takeUntil,
} = require("rxjs/operators");

let users = [];

// Serve static files
app.use(express.static("client"));
app.use(
  "/static",
  express.static("./node_modules/@fortawesome/fontawesome-free")
);

// Start app listening
http.listen(PORT, () => console.log("listening on port: " + PORT));

// Initialise Socket.IO and wrap in observable
const io$ = of(io(http));

// Stream of connections
const connection$ = io$.pipe(
  switchMap((io) =>
    fromEvent(io, "connection").pipe(map((client) => ({ io, client })))
  )
);

// Stream of disconnections
const disconnect$ = connection$.pipe(
  mergeMap(({ client }) => fromEvent(client, "disconnect").pipe(mapTo(client)))
);

// On connection, listen for event
const listenOnConnect = (event) =>
  connection$.pipe(
    mergeMap(({ io, client }) =>
      fromEvent(client, event).pipe(
        takeUntil(fromEvent(client, "disconnect")),
        map((data) => ({ io, client, data }))
      )
    )
  );

// On connection, send array of all users
connection$.subscribe(async ({ io, client }) => {
  console.log("Sending a list of all connected users");
  console.log(users);
  client.emit("all users", users);
});

// On disconnect, tell other users, also remove the entry from users set
disconnect$.subscribe((client) => {
  client.broadcast.emit("remove user", client.id);
  console.log(`Seinding user id to remove : ${client.id}`);
  users = users.filter((user, index) => user.id !== client.id);
});

// Listen for message events and send to relevant users
listenOnConnect("chat message").subscribe(({ client, data }) => {
  const from = users.find((user) => user.id === client.id);
  const { message, to } = data;
  console.log("[New message recieved]");
  console.log(
    `${from.id}, ${from.username}, ${message}, ${to.id}, ${to.username}`
  );
  if (!to.id) return;
  to.id === "everyone"
    ? client.broadcast.emit("chat message", {
        from,
        payload: message,
        to: { id: "everyone", username: "Everyone" },
      }) // Send to everyone
    : client.to(to.id).emit("chat message", { from, payload: message, to }); // Send only to socket
});

// Listen for new usernames and store in corresponding socket object
listenOnConnect("save username").subscribe(
  async ({ io, client, data: username }) => {
    const id = client.id;
    users.push({ id: id, username: username });
    console.log("[New user connected]");
    console.log(users);
    client.broadcast.emit("new user", { id, username });
  }
);
