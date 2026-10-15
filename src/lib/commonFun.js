import { message } from "antd";
import * as UAParser from "ua-parser-js";

export const getDeviceInfo = () => {
  const parser = new UAParser.UAParser(); // Use UAParser from the imported object
  const result = parser.getResult();
console.log(result,'result')
  return {
    os: result.os.name ,
    browser: result.browser.name + " " + result.browser.version || '',
    device: result.device.type || "desktop",
  };
};
export  const sendEmail = async(Data)=>{
    try {
        const res = await fetch("/api/email-send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Data),
        });
        const data = await res.json();
        console.log(data,'data')
        if (data.success) {
          message.success("Email sent successfully!");
        } else {
          message.error(data.error || "Failed to send email.");
        }   
      } catch (error) {
        message.error("An error occurred while sending email.");
      }
}

  export function createSearchIndex(data) {
  const indexSet = new Set();

  const normalize = (text) => {
    return String(text)
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, ""); // remove special chars
  };

  const addPrefixes = (text) => {
    const str = normalize(text);
    if (!str) return;

    // Full phrase prefixes (min 3 chars)
    for (let i = 3; i <= str.length; i++) {
      indexSet.add(str.substring(0, i));
    }

    // Word-based prefixes
    const words = str.split(/\s+/);

    words.forEach((word) => {
      if (word.length >= 3) {
        // Add full word
        indexSet.add(word);

        // Add prefixes (min 3 letters)
        for (let i = 3; i <= word.length; i++) {
          indexSet.add(word.substring(0, i));
        }
      }
    });
  };

  const traverse = (value) => {
    if (!value) return;

    if (Array.isArray(value)) {
      value.forEach(traverse);
    } else if (typeof value === "object") {
      Object.values(value).forEach(traverse);
    } else {
      addPrefixes(value);
    }
  };

  traverse(data);

  return Array.from(indexSet);
}

export function generateMemberPassword(displayName, dob) {
  if (!displayName || !dob) {
    return "Member@123";
  }

  try {
    const firstName = displayName
      .trim()
      .split(" ")[0]
      .toLowerCase()
      .slice(0, 5); // only first 5 letters

    const year = dob.split("-")[2];

    if (!firstName || !year) {
      return "Member@123";
    }

    return `${firstName}${year}`;
  } catch (error) {
    console.error("Password generation error:", error);
    return "Member@123";
  }
}

/** Member logins are created by the server when a member is added/accepted — nothing to do here. */
export function createMemberAccount() {
  return Promise.resolve({ success: true });
}
