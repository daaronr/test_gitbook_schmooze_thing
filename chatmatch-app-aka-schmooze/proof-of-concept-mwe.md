# Proof of Concept MWE

### Minimal Working Example

A minimal working example app can be created using React for the frontend and Node.js with Express for the backend.

#### Frontend (React)

1. Install Node.js if you haven't already (https://nodejs.org/en/download/)
2. Install `create-react-app` globally: `npm install -g create-react-app`
3. Create a new React app: `create-react-app chatmatch`
4. Move into the new directory: `cd chatmatch`
5. Replace the `src/App.js` file with the following code:

```javascript
import React, { useState } from "react";

function App() {
  const [availability, setAvailability] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    alert(`Availability submitted: ${availability}`);
  };

  return (
    <div className="App">
      <h1>ChatMatch - Minimal Working Example</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="availability">Enter your availability:</label>
        <input
          type="text"
          id="availability"
          value={availability}
          onChange={(e) => setAvailability(e.target.value)}
        />
        <button type="submit">Submit</button>
      </form>
    </div>
  );
}

export default App;
```



6. Start the development server: `npm start`

#### Backend (Node.js with Express)

1. Create a new directory for the backend: `mkdir chatmatch-backend && cd chatmatch-backend`
2. Initialize a new Node.js project: `npm init -y`
3. Install Express: `npm install express`
4. Create an `index.js` file in the root of the `chatmatch-backend` directory:

```javascript
javascriptCopy codeconst express = require("express");
const app = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());

app.post("/api/availability", (req, res) => {
  console.log("Availability received:", req.body.availability);
  res.status(200).send({ message: "Availability submitted successfully." });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
```

5. Start the backend server: `node index.js`

This example demonstrates a minimal frontend and backend setup. The frontend allows users to submit their availability, while the backend receives and logs the availability.



This example demonstrates a minimal frontend and backend setup. The frontend allows users to submit their availability, while the backend receives and logs the availability. For a fully functional app, you would need to expand this example to include user registration, authentication, a database, and other features outlined in the summary and suggested approach.

See [next-steps.md](next-steps.md "mention")\
