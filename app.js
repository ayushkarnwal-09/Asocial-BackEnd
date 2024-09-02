const express = require("express");
const app = express();
const server = require("https").createServer({}, app);
const appPort = 4000;
require("dotenv").config();
var logger = require("morgan");
const bodyParser = require("body-parser");
// const { Server } = require("socket.io");
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
app.use(express.json());
app.use(cors());

const io = require("socket.io")(server, { cors: { origin: "*" } });

// declaring socket globally
global.socketio = io;

// backend cors using
app.use(
  cors({
    origin: "*", // Replace with the URL of your frontend - helps in exchanging data on different ports
  })
);

app.use(bodyParser.json());
app.use(logger("dev"));

// Socket io
const phoneNoToSocketIdMap = new Map();
const socketidToPhoneNoMap = new Map();

// io.use((socket, next) => {
//   const token = socket.handshake.headers["authorization"];
//   if (token) {
//     next();
//   } else {
//     next(new Error("Authentication error"));
//   }
// });

io.on("connection", (socket) => {
  console.log(`Socket connected`, socket.id);

  socket.on("room:join", (data) => {
    const { phoneNo, room } = data;
    phoneNoToSocketIdMap.set(phoneNo, socket.id);
    socketidToPhoneNoMap.set(socket.id, phoneNo);
    console.log(socket.id);
    io.to(room).emit("user:joined", { phoneNo, id: socket.id });
    socket.join(room);
    io.to(socket.id).emit("room:join", data);
  });

  socket.on("chatRoom:join", (data) => {
    const { mobileNo } = data;
    phoneNoToSocketIdMap.set(mobileNo, socket.id);
    socketidToPhoneNoMap.set(socket.id, mobileNo);
    console.log(socket.id);
  });

  socket.on("user:call", ({ to, offer }) => {
    io.to(to).emit("incomming:call", { from: socket.id, offer });
  });
  socket.on("call:accepted", ({ to, ans }) => {
    io.to(to).emit("call:accepted", { from: socket.id, ans });
  });
  socket.on("peer:nego:needed", ({ to, offer }) => {
    io.to(to).emit("peer:nego:needed", { from: socket.id, offer });
  });
  socket.on("peer:nego:done", ({ to, ans }) => {
    io.to(to).emit("peer:nego:final", { from: socket.id, ans });
  });

  socket.on("call:hangup", ({ to, endTime }) => {
    console.log(endTime);
    io.to(to).emit("call:hangup", endTime);
  });

  socket.on("exchangePhoneNo", ({ phoneNo, Id }) => {
    io.to(Id).emit("receivePhoneNo", phoneNo);
  });

  socket.on("setRemoteCallStart", ({ Id, startTimer }) => {
    console.log(startTimer);
    io.to(Id).emit("setCallStart", startTimer);
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });

  socket.on("message", ({ roompageMessage, remoteSocketId }) => {
    console.log(roompageMessage);
    console.log(remoteSocketId);
    io.to(1).emit("receive-message", {
      message: roompageMessage,
      socketId: socket.id,
    });
  });

  socket.on("chatMessage", () => {
    io.emit("receive-chatMessage");
  });
});

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((error) => {
    console.error("Error connecting to MongoDB:", error);
  });

// Schema for creating a user
const Users = mongoose.model("Users", {
  mobileNo: {
    type: Number,
  },
  DOB: {
    type: Date,
  },
  name: {
    type: String,
  },
  gender: {
    type: String,
  },
  avatar: {
    type: String,
  },
  interest: {
    type: [String],
  },
  friends: {
    type: [Number],
  },
  sentRequest: {
    type: [Number],
  },
  newRequest: {
    type: [Number],
  },
  blocked: {
    type: [Number],
  },
  VideoChatHistory: {
    type: [Number],
  },
  messageHistory: [
    {
      mobileNo: {
        type: Number,
      },
      messages: [
        {
          msg: {
            type: String,
          },
          mobileNo: {
            type: Number,
          },
        },
      ],
    },
  ],
});

// Schema for online users
const Online = mongoose.model("Online", {
  mobileNo: {
    type: Number,
  },
  DOB: {
    type: Date,
  },
  name: {
    type: String,
  },
  gender: {
    type: String,
  },
  avatar: {
    type: String,
  },
  interest: {
    type: [String],
  },
});

// AUTHENTICATION PORTION

// authenticate token
const authenticateToken = (req, res, next) => {
  const token = req.headers["authorization"];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, process.env.SECRET_KEY, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// GET REQUESTS

// fetching user details using token
app.get("/userDetails", authenticateToken, async (req, res) => {
  try {
    const user = await Users.findById(req.user.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ user });
  } catch (error) {
    console.error("error fetching user details", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.get("/onlineUserDetails", async (req, res) => {
  try {
    const users = await Online.find();
    const friendsData = users.map((user) => ({
      name: user.name,
      avatar: user.avatar,
      mobileNo: user.mobileNo,
    }));
    res.json(friendsData);
  } catch (error) {
    console.error("error fetching user details", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// POST REQUESTS

// Signup section
app.post("/signup", async (req, res) => {
  const { mobileNo, DOB, name, gender, avatar, interest } = req.body;

  try {
    const user = new Users({
      mobileNo,
      DOB,
      name,
      gender,
      avatar,
      interest,
    });

    await user.save();

    const data = {
      user: {
        id: user._id,
      },
    };

    const token = jwt.sign(data, process.env.SECRET_KEY, { expiresIn: "1h" });

    res.status(201).json({ success: true, token });
  } catch (error) {
    console.error("Error during sign-up:", error);
    res.status(500).json({
      success: false,
      errors: ["An error occurred during sign-up. Please try again."],
    });
  }
});

// login section
app.post("/login", async (req, res) => {
  const { mobileNo } = req.body;

  try {
    const user = await Users.findOne({ mobileNo });

    if (user) {
      const data = {
        user: {
          id: user._id,
        },
      };

      const token = jwt.sign(data, "secret_ecom");

      res.status(200).json({ success: true, token });
    } else {
      res.json({ success: false });
    }
  } catch (error) {
    console.error("Error during login:", error);
    res.status(500).json({
      success: false,
      errors: ["An error occurred during login. Please try again."],
    });
  }
});

// setting online user in database
app.post("/setOnlineUser", async (req, res) => {
  const { mobileNo, DOB, name, gender, avatar, interest } = req.body;
  console.log(mobileNo);

  const existingUser = await Online.findOne({ mobileNo });
  if (existingUser) {
    return res.status(200).json({ success: true, message: "already existed" });
  }

  try {
    const online = new Online({
      mobileNo,
      DOB,
      name,
      gender,
      avatar,
      interest,
    });

    await online.save();
    res.status(200).json({ success: true });
  } catch (error) {
    console.error("Error during setting online user:", error);
    res.status(500).json({
      success: false,
      errors: [
        "An error occurred while setting online status. Please try again.",
      ],
    });
  }
});

// adding call chat history
app.post("/addCallHistory", async (req, res) => {
  const { mobileNo, remoteMobileNo } = req.body;
  console.log(mobileNo, remoteMobileNo);
  try {
    const user1 = await Users.findOne({ mobileNo });
    const user2 = await Users.findOne({ mobileNo: remoteMobileNo });
    if (!user1 || !user2) {
      return res.status(404).json({ message: "User not found" });
    }
    user1.VideoChatHistory.push(remoteMobileNo);
    await user1.save();
    user2.VideoChatHistory.push(mobileNo);
    await user2.save();

    res.status(200).json({ message: "video Call Ended." });
  } catch (error) {
    console.log("Error in adding video chat history", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Adding User to Block List
app.post("/addingUserToBlockedList", async (req, res) => {
  const { mobileNo, remoteMobileNo } = req.body;
  try {
    // user1
    const user1 = await Users.findOne({ mobileNo });
    const user2 = await Users.findOne({ mobileNo: remoteMobileNo });
    if (!user1 || !user2) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user1.blocked.includes(remoteMobileNo)) {
      user1.blocked.push(remoteMobileNo);
      await user1.save();
    }

    await Users.updateOne({ mobileNo }, { $pull: { friends: remoteMobileNo } });

    if (!user2.blocked.includes(remoteMobileNo)) {
      user2.blocked.push(remoteMobileNo);
      await user2.save();
    }

    await Users.updateOne({ remoteMobileNo }, { $pull: { friends: mobileNo } });

    res.status(200).json({ message: "User added to block list" });
  } catch (error) {
    console.log("Error in adding the user to block list", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/unfriend", async (req, res) => {
  try {
    const { mobileNo, remoteMobileNo } = req.body;
    const user = await Users.findOne({ mobileNo });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await Users.updateOne({ mobileNo }, { $pull: { friends: remoteMobileNo } });
    res.status(200).json({ message: "User Unfriend!" });
  } catch (error) {
    console.log("Error in adding the user to block list", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// Sending Friend Request

app.post("/sendRequest", async (req, res) => {
  const { phoneNo, remotePhoneNo } = req.body;

  try {
    const user1 = await Users.findOne({ mobileNo: phoneNo });
    const user2 = await Users.findOne({ mobileNo: remotePhoneNo });

    if (!user1 || !user2) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user1.sentRequest.includes(remotePhoneNo)) {
      user1.sentRequest.push(remotePhoneNo);
    }
    if (!user2.newRequest.includes(phoneNo)) {
      user2.newRequest.push(phoneNo);
    }
    await user1.save();
    await user2.save();

    res.status(201).json({ message: "Request Send!" });
  } catch (error) {
    console.error("Error adding friend:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/fetchUserFriends", async (req, res) => {
  const { mobileNo } = req.body;

  try {
    // Fetch the user by mobile number
    const user = await Users.findOne({ mobileNo });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Find all users whose mobile numbers are in the user's friends array
    const friends = await Users.find({ mobileNo: { $in: user.friends } });

    // If no friends are found, return a message indicating so
    if (friends.length === 0) {
      return res.status(404).json({ message: "No friends found" });
    }

    // Map the friends data to return only the necessary information
    const friendsData = friends.map((friend) => ({
      name: friend.name,
      avatar: friend.avatar,
      mobileNo: friend.mobileNo,
    }));

    // Send the friends data as the response
    res.status(200).json(friendsData);
  } catch (error) {
    console.error("Error fetching user friends:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// majorly a get request but used post because of sending user data from from frontend to get details from database

// fetching sent request of users

app.post("/fetchUserSentRequests", async (req, res) => {
  const { mobileNo } = req.body;

  try {
    console.log(mobileNo);

    // Find the user by mobile number
    const user = await Users.findOne({ mobileNo: mobileNo });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log(user.sentRequest);

    // Check if sendRequest array exists and is not empty
    if (!user.sentRequest || user.sentRequest.length === 0) {
      return res.status(200).json({ message: "No sent requests found" });
    }

    // Find the users whose mobile numbers are in the sendRequest list
    const requestedUsers = await Users.find({
      mobileNo: { $in: user.sentRequest },
    });

    if (requestedUsers.length === 0) {
      return res
        .status(404)
        .json({ message: "No users found for the sent requests" });
    }

    // Extract the needed data from the found users
    const friendsData = requestedUsers.map((friend) => ({
      name: friend.name,
      avatar: friend.avatar,
      mobileNo: friend.mobileNo,
    }));

    // Send the response with the found data
    res.status(200).json(friendsData);
  } catch (error) {
    console.error("Error fetching user sent requests:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// cancelling sent request
app.post("/handleSentRequestCancel", async (req, res) => {
  const { mobileNo, remoteMobileNo } = req.body;
  try {
    const user1 = await Users.findOne({ mobileNo });
    if (!user1) {
      return res.status(404).json({ message: "User not found" });
    }

    const user2 = await Users.findOne({ mobileNo: remoteMobileNo });
    if (!user2) {
      return res.status(404).json({ message: "Remote user not found" });
    }

    await Users.updateOne(
      { mobileNo },
      { $pull: { sentRequest: remoteMobileNo } }
    );
    await Users.updateOne(
      { mobileNo: remoteMobileNo },
      { $pull: { newRequest: mobileNo } }
    );

    res.status(200).json({ message: "Friend request accepted successfully" });
  } catch (error) {
    console.error("Error in accepting the requests:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// fetching new requests of users
app.post("/fetchUserNewRequests", async (req, res) => {
  const { mobileNo } = req.body;

  try {
    console.log(mobileNo);

    // Find the user by mobile number
    const user = await Users.findOne({ mobileNo: mobileNo });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log(user.newRequest);

    // Check if sendRequest array exists and is not empty
    if (!user.newRequest || user.newRequest.length === 0) {
      return res.status(200).json({ message: "No sent requests found" });
    }

    // Find the users whose mobile numbers are in the sendRequest list
    const requestedUsers = await Users.find({
      mobileNo: { $in: user.newRequest },
    });

    if (requestedUsers.length === 0) {
      return res
        .status(404)
        .json({ message: "No users found for the sent requests" });
    }

    // Extract the needed data from the found users
    const friendsData = requestedUsers.map((friend) => ({
      name: friend.name,
      avatar: friend.avatar,
      mobileNo: friend.mobileNo,
    }));

    // Send the response with the found data
    res.status(200).json(friendsData);
  } catch (error) {
    console.error("Error fetching user sent requests:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

app.post("/acceptingNewRequest", async (req, res) => {
  const { mobileNo, remoteMobileNo } = req.body;
  try {
    const user1 = await Users.findOne({ mobileNo });
    if (!user1) {
      return res.status(404).json({ message: "User not found" });
    }

    const user2 = await Users.findOne({ mobileNo: remoteMobileNo });
    if (!user2) {
      return res.status(404).json({ message: "Remote user not found" });
    }

    // Remove the request from user1's newRequest array using $pull
    await Users.updateOne(
      { mobileNo },
      { $pull: { newRequest: remoteMobileNo } }
    );

    // Add remoteMobileNo to user1's friends list if not already added
    if (!user1.friends.includes(remoteMobileNo)) {
      user1.friends.push(remoteMobileNo);
      await user1.save();
    }

    // adding remoteMobileNo to user1 messageHistory with empty array.
    await Users.updateOne(
      { mobileNo },
      {
        $push: {
          messageHistory: {
            mobileNo: remoteMobileNo,
            messages: [],
          },
        },
      }
    );

    // Remove the request from user2's sentRequest array using $pull
    await Users.updateOne(
      { mobileNo: remoteMobileNo },
      { $pull: { sentRequest: mobileNo } }
    );

    // Add mobileNo to user2's friends list if not already added
    if (!user2.friends.includes(mobileNo)) {
      user2.friends.push(mobileNo);
      await user2.save();
    }

    // adding remoteMobileNo to user1 messageHistory with empty array.
    await Users.updateOne(
      { mobileNo: remoteMobileNo },
      {
        $push: {
          messageHistory: {
            mobileNo: mobileNo,
            messages: [],
          },
        },
      }
    );

    res.status(200).json({ message: "Friend request accepted successfully" });
  } catch (error) {
    console.error("Error in accepting the requests:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// cancelling new Request
app.post("/cancellingNewRequest", async (req, res) => {
  const { mobileNo, remoteMobileNo } = req.body;
  try {
    const user1 = await Users.findOne({ mobileNo });
    if (!user1) {
      return res.status(404).json({ message: "User not found" });
    }

    const user2 = await Users.findOne({ mobileNo: remoteMobileNo });
    if (!user2) {
      return res.status(404).json({ message: "Remote user not found" });
    }

    // Remove the request from user1's newRequest array using $pull
    await Users.updateOne(
      { mobileNo },
      { $pull: { newRequest: remoteMobileNo } }
    );

    // Remove the request from user2's sentRequest array using $pull
    await Users.updateOne(
      { mobileNo: remoteMobileNo },
      { $pull: { sentRequest: mobileNo } }
    );

    res.status(200).json({ message: "Friend request accepted successfully" });
  } catch (error) {
    console.error("Error in accepting the requests:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// fetching Blocked Users
app.post("/fetchBlockedUsers", async (req, res) => {
  const { mobileNo } = req.body;
  try {
    const user = await Users.findOne({ mobileNo });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const blockedUsers = await Users.find({ mobileNo: { $in: user.blocked } });

    if (blockedUsers.length === 0) {
      return res.status(200).json({ message: "No Blocked User found" });
    }

    const blockedUserData = blockedUsers.map((friend) => ({
      name: friend.name,
      avatar: friend.avatar,
      mobileNo: friend.mobileNo,
    }));

    res.status(200).json(blockedUserData);
  } catch (error) {
    console.error("Error in fetching blocked user :", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// fetching user message history array
app.post("/fetchUsermessageHistory", async (req, res) => {
  const { mobileNo, targetMobileNo } = req.body; // Extract mobileNo and targetMobileNo from the request body

  try {
    // Find the user by mobileNo
    const user = await Users.findOne({ mobileNo: mobileNo });

    if (!user) {
      // If user is not found, send a 404 response
      return res.status(404).json({ message: "User not found" });
    }

    // Find the target messages based on targetMobileNo inside messageHistory
    const targetHistory = user.messageHistory.find(
      (history) => history.mobileNo === targetMobileNo
    );

    if (!targetHistory) {
      // If target mobileNo's message history is not found, send a 404 response
      return res
        .status(404)
        .json({ message: "Target message history not found" });
    }

    // Return the messages array for the target mobileNo
    res.json({ messages: targetHistory.messages });
  } catch (error) {
    // Handle any errors that occur during the query
    console.error("Error fetching messages:", error);
    res
      .status(500)
      .json({ message: "An error occurred while fetching the messages" });
  }
});

// updating user message history
app.post("/fetchUpdatingUserHistoryMessage", async (req, res) => {
  const { obj, mobileNo, targetMobileNo } = req.body;
  try {
    // Find the user by their mobile number
    const user1 = await Users.findOne({ mobileNo: mobileNo });
    const user2 = await Users.findOne({ mobileNo: targetMobileNo });

    if (!user1) {
      // If the user is not found, send a 404 response
      return res.status(404).json({ message: "User1 not found" });
    }
    if (!user2) {
      // If the user is not found, send a 404 response
      return res.status(404).json({ message: "User2 not found" });
    }

    // Directly update the messages array for the specific targetMobileNo
    await Users.updateOne(
      { mobileNo: mobileNo, "messageHistory.mobileNo": targetMobileNo },
      { $push: { "messageHistory.$.messages": obj } }
    );
    await Users.updateOne(
      { mobileNo: targetMobileNo, "messageHistory.mobileNo": mobileNo },
      { $push: { "messageHistory.$.messages": obj } }
    );

    // Fetch the updated user to send back the updated message history
    const updatedUser = await Users.findOne({ mobileNo: mobileNo });
    // Find the updated message history for the targetMobileNo
    const updatedTargetHistory = updatedUser.messageHistory.find(
      (history) => history.mobileNo === targetMobileNo
    );

    // Send back the updated messages array of the targetMobileNo
    res.status(200).json({ messages: updatedTargetHistory.messages });
  } catch (error) {
    console.error("Error updating message history:", error);
    res.status(500).json({ message: "Server error" });
  }
});

//fetching videoChatHistory from users
app.post("/fetchVideoChatHistory", async (req, res) => {
  const { mobileNo } = req.body;

  try {
    // Find the user by their mobile number
    const user = await Users.findOne({ mobileNo });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Extract the VideoChatHistory array
    const videoChatHistory = user.VideoChatHistory;

    // Initialize an array to store all results
    const videoChatHistoryUsersData = [];

    // Loop through the VideoChatHistory to include duplicates
    for (const targetMobileNo of videoChatHistory) {
      const friend = await Users.findOne({ mobileNo: targetMobileNo });
      if (friend) {
        videoChatHistoryUsersData.push({
          name: friend.name,
          avatar: friend.avatar,
          mobileNo: friend.mobileNo,
        });
      }
    }

    // Respond with the fetched data including duplicates
    res.status(200).json(videoChatHistoryUsersData);
  } catch (error) {
    console.error("Error in fetching Video Chat History:", error);
    res.status(500).json({ message: "Internal server error" });
  }
});

// removing interest items from myAccount page-
app.post("/removeInterestThroughMyAccount", async (req, res) => {
  const { mobileNo, item } = req.body;

  try {
    await Users.updateOne({ mobileNo }, { $pull: { interest: item } });
    const updatedUser = await Users.findOne({ mobileNo });

    // Respond with the updated interests array
    res.json({ data: updatedUser.interest });
  } catch (error) {
    console.error("Error removing item:", error);
    res.status(500).json({ error: "Failed to remove item" });
  }
});

// adding interest items from myAccount page-
app.post("/addingInterestThroughMyAccount", async (req, res) => {
  const { mobileNo, item } = req.body;

  try {
    await Users.updateOne({ mobileNo }, { $push: { interest: item } });
    const updatedUser = await Users.findOne({ mobileNo });

    // Respond with the updated interests array
    res.json({ data: updatedUser.interest });
  } catch (error) {
    console.error("Error removing item:", error);
    res.status(500).json({ error: "Failed to remove item" });
  }
});

app.get("/", (req, res) => {
  console.log("hello world");
  res.send("Hello from the server!");
});

// sending sms section
app.post("/sendSms", async (req, res) => {
  let sixDigitNumber;
  const { mobileNo } = req.body;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  const client = require("twilio")(accountSid, authToken);
  console.log("client", client);

  const sendSMS = async (body) => {
    let msgOptions = {
      from: process.env.TWILIO_FROM_NUMBER,
      to: process.env.TWILIO_TO_NUMBER,
      body,
    };
    try {
      const message = await client.messages.create(msgOptions);
      console.log(message);
      return message;
    } catch (err) {
      console.log(err);
      throw err;
    }
  };

  function generateSixDigitNumber() {
    const randomNumber = Math.floor(100000 + Math.random() * 900000);
    return randomNumber;
  }

  sixDigitNumber = generateSixDigitNumber();

  try {
    // const message = await sendSMS(
    //   `your verification code is ${sixDigitNumber}`
    // );
    res.json({
      message: `SMS sent to ${mobileNo}`,
      // sid: message.sid,
      code: sixDigitNumber,
    });
  } catch (err) {
    res.status(500).json({ error: "failed to send sms" });
  }
});

// Running Servers
server.listen(appPort, (error) => {
  if (!error) {
    console.log("server running on Port " + appPort);
  } else {
    console.log("Error : " + error);
  }
});
