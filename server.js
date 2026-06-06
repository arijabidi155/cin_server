require('dotenv').config();
const express = require('express');
const { GoogleGenAI } = require('@google/genai');

const app = express();
app.use(express.json()); // To parse JSON payloads from Flutter

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.post('/api/verify-cin', async (req, res) => {
    try {
        const { cloudinary_url } = req.body;

        if (!cloudinary_url) {
            return res.status(400).json({ error: "Cloudinary URL manquante." });
        }

        console.log(`🔗 Analyse de l'image via URL Cloudinary: ${cloudinary_url}`);

        // 1. Fetch the image directly via URL for Gemini
        const responseFile = await fetch(cloudinary_url);
        const buffer = await responseFile.arrayBuffer();

        const imagePart = {
            inlineData: {
                data: Buffer.from(buffer).toString("base64"),
                mimeType: "image/jpeg" // Cloudinary standard return
            },
        };

        // 2. Strict Recto System Prompt
        const systemPrompt = `
        # ROLE & CONTEXT
        You are a production-grade, highly precise Document AI specialized in Tunisian Identity Documents. Your single task is to validate and extract structured data from the RECTO (front) side of a Tunisian National Identity Card (بطاقة التعريف الوطنية التونسية).

        # INPUT CONDITIONALITY
        You are given an image path. The document inside MUST match the official standardized layout of a Tunisian CIN Recto.

        # CRITICAL VALIDATION RULES & VISUAL HEURISTICS
        Before extracting data, perform these validation checks strictly:
        1. Document Type Check: Verify the core text blocks at the TOP CENTER of the card layout: "الجمهورية التونسية" on the upper line and "بطاقة التعريف الوطنية" directly beneath it.
        2. Recto Specific Visual Anchors: 
        - Verify the presence of the Tunisian Flag located precisely near the TOP LEFT corner.
        - Verify the presence of the official Emblem of Tunisia (Armoiries de la Tunisie) located precisely near the TOP RIGHT corner.
        - Verify the presence of the holder's official identity photograph on the card.
        - If the Tunisian Flag (left), the Emblem (right), or the photo is missing, or if the layout looks like the VERSO/back side, immediately flag "is_tunisian_cin" as false.
        3. Quality Check: Is the text readable enough for safe data entry? If blurred, covered by flash glare, or heavily cropped, flag as low confidence.

        # DATA EXTRACTION & LINGUISTIC MAPPING RULES
        If and only if the card is valid (\`is_tunisian_cin\` is true), extract the fields strictly following these guidelines:

        - \`cin_number\`: Find the 8-digit unique serial number. Extract as a clean string of exactly 8 numeric digits. Remove any spaces or accidental characters.
        - \`first_name_ar\`: Extract the holder's given name written in Arabic script (الاسم).
        - \`last_name_ar\`: Extract the holder's family/surname written in Arabic script (اللقب).
        - \`first_name_fr\`: Automatically translate/transliterate the extracted Arabic given name into French text following standard Tunisian spelling conventions (e.g., "أريج" becomes "Arij").
        - \`last_name_fr\`: Automatically translate/transliterate the extracted Arabic family name into French text following standard Tunisian spelling conventions.
        - \`date_of_birth\`: Locate the date of birth (تاريخ الولادة / ولد في). Extract the digits and return them strictly in the human-readable standard format: DD/MM/YYYY (e.g., 15/08/1998). Do not normalize to ISO YYYY-MM-DD.

        # BEHAVIORAL CONSTRAINTS
        - Strict Structural Enforcement: If any text field is blurry, obscured, or completely missing from the card structure, return null for that specific property. DO NOT invent, hallucinate, or guess numbers/names.
        - Pure JSON Rule: Do not write any conversational preamble, markdown markers, or summary explanations. Return only the requested JSON scheme map directly.

        # REQUIRED OUTPUT SCHEMA
        Ensure the parsed result completely implements this exact JSON tree:
        {
            "is_tunisian_cin": true or false,
            "confidence_score": "high" or "medium" or "low",
            "rejection_reason": "Clear French explanation if validation fails (e.g., 'Emblème ou drapeau manquant', 'Document non reconnu'), otherwise null",
            "extracted_data": {
                "cin_number": "8-digit string" or null,
                "first_name_ar": "Arabic text" or null,
                "last_name_ar": "Arabic text" or null,
                "first_name_fr": "French translation text" or null,
                "last_name_fr": "French translation text" or null,
                "date_of_birth": "DD/MM/YYYY string" or null
            }
        }
        `;

        // 3. Call Gemini 2.5 Flash
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [imagePart, systemPrompt],
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        is_tunisian_cin: { type: "BOOLEAN" },
                        confidence_score: { type: "STRING" },
                        rejection_reason: { type: "STRING" },
                        extracted_data: {
                            type: "OBJECT",
                            properties: {
                                cin_number: { type: "STRING" },
                                first_name_ar: { type: "STRING" },
                                last_name_ar: { type: "STRING" },
                                first_name_fr: { type: "STRING" },
                                last_name_fr: { type: "STRING" },
                                date_of_birth: { type: "STRING" }
                            }
                        }
                    }
                }
            }
        });

        const resultJson = JSON.parse(response.text);
        return res.json(resultJson);

    } catch (error) {
        console.error("❌ Process Error:", error);
        return res.status(500).json({ error: "Le traitement de la carte a échoué." });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));