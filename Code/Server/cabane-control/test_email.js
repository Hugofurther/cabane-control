require('dotenv').config();
const nodemailer = require('nodemailer');

async function runTest() {
    console.log("--- Email Configuration Test ---");
    console.log(`Host: ${process.env.EMAIL_HOST}`);
    console.log(`Port: ${process.env.EMAIL_PORT}`);
    console.log(`User: ${process.env.EMAIL_USER}`);
    console.log("Pass: " + (process.env.EMAIL_PASS ? "****** (Loaded)" : "MISSING"));

    const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST,
        port: process.env.EMAIL_PORT,
        secure: false, // true for 465, false for other ports
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    try {
        console.log("\nAttempting to verify connection...");
        await transporter.verify();
        console.log("✅ Connection Successful! Credentials are valid.");

        console.log("Attempting to send email...");
        const info = await transporter.sendMail({
            from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Send to yourself
            subject: "Test from Cabane Pi",
            text: "If you are reading this, the email system is working perfectly.",
        });

        console.log(`✅ Email Sent! Message ID: ${info.messageId}`);
    } catch (error) {
        console.error("\n❌ FAILED:");
        console.error(error);
    }
}

runTest();