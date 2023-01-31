import express from "express";
import dotenv from "dotenv";
import { Client } from "pg";

dotenv.config();

const app = express();
app.use(express.json());

// console.log(process.env);

const client = new Client({
  host: process.env.POSTGRES_HOST,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  port: parseInt(process.env.POSTGRES_PORT),
  ssl: {
    rejectUnauthorized: false,
  },
});

client.connect();
client
  .query(
    `
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    age INTEGER NOT NULL
  )
`
  )
  .then(() => {
    console.log("Users table created successfully");
  })
  .catch((error) => {
    console.error(error);
  });

// API for writing data
app.post("/write", async (req, res) => {
  try {
    const { name, age } = req.body;
    const result = await client.query(
      "INSERT INTO users (name, age) VALUES ($1, $2)",
      [name, age]
    );
    res
      .status(201)
      .json({ message: "Data written successfully", data: result });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to write data" });
  }
});

// API for reading data
app.get("/read", async (req, res) => {
  try {
    const result = await client.query("SELECT * FROM users");
    // console.log(result);
    res.status(200).json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to read data" });
  }
});

app.listen(3000, () => {
  console.log("Server started on port 3000");
});
