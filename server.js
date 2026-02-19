const http = require('http');
const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');
const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { authJwt } = require('./Middleware/Jwt');
const Routes = require('./Routers/Routes');
const connectDB = require('./Models/Config/mongoose.config.js'); 
const { MakeData } = require('./superadmin.js'); 
const cron = require('node-cron');
const checkandUpdateMeterialsetData = require('./Service/MaterialSetUpdateDate.js');
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());


const uploadPath = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadPath)) {
  fs.mkdirSync(uploadPath, { recursive: true });
  console.log('public/uploads/ folder created automatically');
}

app.use('/public/uploads', express.static(uploadPath));
app.use(authJwt());

app.use('/api/v1', Routes);

cron.schedule('0 1 * * *', async () => {

  // cron.schedule('*/1 * * * *', async () => {
  console.log('Running every  1 minute');
  await checkandUpdateMeterialsetData();
  console.log('Material set date updated.');
});

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB();
    console.log(`Connected to MongoDB at ${process.env.DB_URI}`);

    const server = http.createServer(app);

    global.io = socketIO(server, {
      pingTimeout: 60000,
      cors: {
        origin: [
          "http://localhost:8080",
          "http://31.97.239.151:8080"
        ],
        credentials: true,
      },
    });

    global.user_array = [];

    const removeUser = (socketId) => {
      global.user_array = global.user_array.filter(
        user => user.socket_id !== socketId
      );
    };

    io.on('connection', (socket) => {
      console.log('New socket connected:', socket.id);

      socket.on('token', async ({ token }) => {
        try {
          const decode = jwt.verify(token, process.env.ACCESS_TOKEN_KEY);

          if (!decode?.id) {
            return socket.disconnect();
          }

          const userObj = {
            user_id: decode.id,
            socket_id: socket.id,
          };

          const index = global.user_array.findIndex(
            u => u.user_id === decode.id
          );
          console.log("global.user_array",global.user_array)
          console.log("index",index)

          if (index > -1) {
            global.user_array[index] = userObj;
          } else {
            global.user_array.push(userObj);
          }

          console.log('User connected via socket:', userObj);
        } catch (err) {
          console.log('Invalid socket token');
          socket.disconnect();
        }
      });

      socket.on('disconnect', () => {
        console.log('Socket disconnected:', socket.id);
        removeUser(socket.id);
      });
    });

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running at http://localhost:${PORT}`);
    });

    if (process.argv[2] === 'Add_Data') {
      console.log('Adding data to database...');
      await MakeData();

      setTimeout(() => {
        server.close(() => {
          console.log('Server stopped after seeding');
          process.exit(0);
        });
      }, 10000);
    }

  } catch (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }
};

startServer();


