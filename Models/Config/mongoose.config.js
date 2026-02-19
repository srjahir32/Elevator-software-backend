const mongoose = require("mongoose")
require("dotenv").config()
const dbUrl = process.env.DB_URI || "";

const connectDB = async () => {
    try {
        await mongoose.connect(dbUrl).then(() => {
            console.log(`Database connected`)
            return true
        })
    } catch (error) {
        console.log(error.message)
        setTimeout(connectDB, 5000)
    }
}

module.exports = connectDB