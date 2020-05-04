//TODO: Fix the SuccessfulPurchaseHandler so that it can handle the subscription too.
//TODO: Handle when someone tries to cancel their subscription.
//TODO: Do we allow users to play games from previous weeks?  (Maybe this is a "premium" feature, that also includes one hint a week?)
//TODO: Give the user the option to send another pin if they don't have it.
//TODO: Should new users get a free hint when they first start playing the game?
//TODO: How does a user get a text message clue sent "again?"  What if they accidentally delete it?
//TODO: What happens if someone is playing a game while the date for the game flips?
//TODO: When a user has already heard a puzzle, do we need to automatically give it to them again when they return to answer it?  Maybe we should as them if they want to answer the puzzle, or hear it again when they return?

const Alexa = require('ask-sdk-core');
const AWS = require("aws-sdk");
const https = require("https");
const Airtable = require("airtable");

const introSound = "<audio src='soundbank://soundlibrary/computers/beeps_tones/beeps_tones_13'/>";

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    async handle(handlerInput) {
        console.log("<=== LAUNCHREQUEST HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "LaunchRequest";
        const locale = handlerInput.requestEnvelope.request.locale;

        //TODO: What does the first time user experience look like?  We probably need to explain what is happening, and what they should do.

        var speakOutput = "";
        var actionQuery = "";
        
        console.log("SESSION ATTRIBUTES = " + JSON.stringify(sessionAttributes));
        if (sessionAttributes.user.MobileNumber === undefined) {
            return PhoneNumberIntentHandler.handle(handlerInput);
        }
        else if (sessionAttributes.user.MobileNumber != undefined && sessionAttributes.user.IsValidated === undefined) {
            return PhoneNumberIntentHandler.handle(handlerInput);
        }
        else if (sessionAttributes.user.MobileNumber != undefined && sessionAttributes.user.IsValidated === true) {
            var welcome = await getRandomSpeech("Welcome", locale);
            return giveNextPuzzle(handlerInput, welcome);
        }

        speakOutput = introSound + speakOutput + " " + actionQuery;
        
        return handlerInput.responseBuilder
        .speak(speakOutput)
        .reprompt(actionQuery)
        .getResponse();
        
    }
};

const PhoneNumberIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'PhoneNumberIntent';
    },
    async handle(handlerInput) {
        console.log("<=== PHONENUMBERINTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const locale = handlerInput.requestEnvelope.request.locale;
        var phoneNumber = getSpokenWords(handlerInput, "phoneNumber");
        var speakOutput = "";
        if (sessionAttributes.previousAction === "LaunchRequest") {
            var welcome = await getRandomSpeech("Welcome", locale);
            speakOutput = introSound + welcome + " ";
        }
        var actionQuery = "";
        sessionAttributes.previousAction = "PhoneNumberIntent";
        phoneNumber = fixPhoneNumber(phoneNumber, locale);
        if (phoneNumber != undefined) {
            var pin = getRandom(1000, 9999);
            await sendTextMessage(phoneNumber, "Your validation PIN is " + pin + ". If the skill has closed, you can say \"Alexa, tell Scavenger Hunt my pin is " + pin + "\".");
            await updateUserRecord(handlerInput, phoneNumber, pin, false);
            speakOutput += "I just sent a message with a four digit PIN to validate your mobile phone number. ";
            actionQuery = "What is that PIN?";
            sessionAttributes.expectedAction = "PinValidationIntent";
        }
        else {
            speakOutput += await getRandomSpeech("AskForPhoneNumber", locale);
            actionQuery = "What is your full mobile phone number?";
            sessionAttributes.expectedAction = "PhoneNumberIntent";
        }
        return handlerInput.responseBuilder
            .speak(speakOutput + actionQuery)
            .reprompt(actionQuery)
            .getResponse();
    }
};

const PinValidationIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'PinValidationIntent';
    },
    async handle(handlerInput) {
        console.log("<=== PINVALIDATIONINTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "PinValidationIntent";
        const locale = handlerInput.requestEnvelope.request.locale;
        var pin = getSpokenWords(handlerInput, "pin");

        if (sessionAttributes.user.ValidationPin.toString() != pin.toString()) {
            console.log("PIN DIDN'T MATCH.");
            await updateUserRecord(handlerInput);
            sessionAttributes.previousAction = "PhoneNumberIntent";
            return LaunchRequestHandler.handle(handlerInput);
        }
        else {
            await updateUserRecord(handlerInput, sessionAttributes.user.MobileNumber, sessionAttributes.user.ValidationPin, true);
            sessionAttributes.previousAction = "PinValidationIntent";
            return giveNextPuzzle(handlerInput, "Your phone number has been validated! ");
        }
    }
};

async function giveNextPuzzle(handlerInput, prespeech) {
    console.log("<=== GIVENEXTPUZZLE FUNCTION ===>");
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    const locale = handlerInput.requestEnvelope.request.locale;
    var speakOutput = prespeech + " ";
    if (sessionAttributes.previousAction === "LaunchRequest") speakOutput = introSound;
    sessionAttributes.previousAction = "Puzzle";
    var answerQuery = await getRandomSpeech("AnswerQuery", locale);
    
    if (sessionAttributes.game.length > 0) {
        console.log("CHECKING TO DETERMINE IF TEXT MESSAGE SHOULD BE SENT.");
        if (sessionAttributes.game[0].fields.TextResponse != undefined) await sendTextMessage(sessionAttributes.user.MobileNumber, sessionAttributes.game[0].fields.TextResponse);
        console.log("CHECKING TO DETERMINE IF CARD RESPONSE SHOULD BE SENT.");
        if (sessionAttributes.game[0].fields.CardResponse != undefined) {
            console.log("CHECKING TO DETERMINE IF THERE'S AN IMAGE FOR THE CARD.");
            if (sessionAttributes.game[0].fields.Media != undefined) {
                console.log("SENDING STANDARD CARD.");
                handlerInput.responseBuilder.withStandardCard(sessionAttributes.game[0].fields.GameDate, sessionAttributes.game[0].fields.Title, sessionAttributes.game[0].fields.Media[0].url, sessionAttributes.game[0].fields.Media[0].url);
            }
            else {
                console.log("SENDING SIMPLE CARD.");
                handlerInput.responseBuilder.withSimpleCard(sessionAttributes.game[0].fields.GameDate, sessionAttributes.game[0].fields.Title);
            }
        }
        console.log("CHECKING TO DETERMINE IF THERE'S A SCREEN RESPONSE.");
        if (sessionAttributes.game[0].fields.Media != undefined) {
            console.log("CHECKING TO DETERMINE IF THE USER'S DEVICE SUPPORTS APL.");
            if (supportsAPL(handlerInput)) {
                var apl = "";
                if (sessionAttributes.game[0].fields.Media[0].type === "image/png") {
                    apl = require('apl/image.json');
                    //TODO: USE THE DATASOURCE INSTEAD, DUMMY.
                    apl.mainTemplate.items[0].items[0].source = sessionAttributes.game[0].fields.Media[0].url;
                    apl.mainTemplate.items[0].items[1].headerTitle = sessionAttributes.game[0].fields.Title;
                    apl.mainTemplate.items[0].items[2].items[0].source = sessionAttributes.game[0].fields.Media[0].url;
                    apl.mainTemplate.items[1].items[1].headerTitle = sessionAttributes.game[0].fields.Title;
                    apl.mainTemplate.items[1].items[2].items[0].source = sessionAttributes.game[0].fields.Media[0].url;
                }
                else if (sessionAttributes.game[0].fields.Media[0].type === "video/mp4") {
                    apl = require('apl/video.json');
                    apl.mainTemplate.items[0].items[0].source = sessionAttributes.game[0].fields.Media[0].url;
                }   
                handlerInput.responseBuilder.addDirective({
                    type: 'Alexa.Presentation.APL.RenderDocument',
                    version: '1.3',
                    document: apl, 
                    datasources: {}
                  })
            }
        }
        console.log("CREATING DYNAMIC ENTITIES.");
        var synonyms = [];
        if (sessionAttributes.game[0].fields.Synonyms != undefined) synonyms = sessionAttributes.game[0].fields.Synonyms.split(", ");
        let dynamicEntities = {
            type: "Dialog.UpdateDynamicEntities",
            updateBehavior: "REPLACE",
            types: [
            {
                name: "Answer",
                values: [
                    {
                        id: sessionAttributes.game[0].id,
                        name: {
                            value: sessionAttributes.game[0].fields.Answer,
                            synonyms: synonyms
                        }
                    },
                ]
            }]
        };
        handlerInput.responseBuilder.addDirective(dynamicEntities);
        //TODO: IF THEY ALREADY HAVE A USERPUZZLE RECORD, DON'T INSERT ANOTHER ONE.
        var puzzleId = sessionAttributes.game[0].id;
        var airtable = new Airtable({apiKey: process.env.airtable_api_key}).base(process.env.airtable_base_data);
        var record = await new Promise((resolve, reject) => {
            airtable('UserPuzzle').create({
                "User": [sessionAttributes.user.RecordId],
                "Puzzle": [puzzleId]
                }, function(err, record) {
                if (err) {
                    console.error(err);
                    return;
                }
                resolve(record);
                });
        });

        console.log("SENDING VOICE RESPONSE.");
        speakOutput += sessionAttributes.game[0].fields.VoiceResponse;
    }
    else {
        //TODO: WHAT IS THE DIFFERENCE BETWEEN I "JUST" WON, AND I ALREADY WON?
        speakOutput += await getRandomSpeech("AlreadyWon", locale);
        answerQuery = await getRandomSpeech("ActionQuery", locale);
    }
    

    return handlerInput.responseBuilder
        .speak(speakOutput + " " + answerQuery)
        .reprompt(answerQuery)
        .getResponse();
}

const AnswerIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AnswerIntent';
    },
    async handle(handlerInput) {
        console.log("<=== ANSWERINTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const locale = handlerInput.requestEnvelope.request.locale;
        sessionAttributes.previousAction = "AnswerIntent";

        var spokenWords = getSpokenWords(handlerInput, "answer");
        var resolvedWords = getResolvedWords(handlerInput, "answer");
        var puzzleId = sessionAttributes.game[0].id;

        var speakOutput = "";

        if (resolvedWords != undefined) {
            console.log("RESOLVED WORDS = " + JSON.stringify(resolvedWords));
            if (resolvedWords[0].value.id === puzzleId) {
                //TODO: UPDATE THE USERPUZZLE RECORD FOR THE USER WHEN THEY GET THE ANSWER CORRECT.
                var correctResponse = await getRandomSpeech("correctResponse", locale)
                return await giveNextPuzzle(handlerInput, correctResponse);
            }
            //TODO: WHAT DO YOU DO IF THEY MATCH AN ANSWER BUT IT ISN'T THE ANSWER TO THE CURRENT QUESTION?
        }
        else {
            var incorrectAnswer = await getRandomSpeech("IncorrectAnswer", locale);
            var incorrectReprompt = await getRandomSpeech("IncorrectReprompt", locale);
            var repromptOutput = incorrectReprompt;
            speakOutput = incorrectAnswer + " " + repromptOutput;
        }
        
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(repromptOutput)
            .getResponse();
    }
};

const ChangePhoneNumberIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'ChangePhoneNumberIntent';
    },
    handle(handlerInput) {
        console.log("<=== CHANGE PHONE NUMBER INTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "ChangePhoneNumberIntent";
        const speakOutput = "OK.  What is your new phone number?";

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const UnsubscribeIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'UnsubscribeIntent';
    },
    handle(handlerInput) {
        console.log("<=== UNSUBSCRIBE HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "UnsubscribeIntent";
        const speakOutput = "OK.  You want to remove your phone number.  I can do this for you, but you won't be able to play this game anymore.  Is that OK?";

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const YesNoIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && ((Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.YesIntent') ||
               (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NoIntent'));
    },
    async handle(handlerInput) {
        console.log("<=== HELPINTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        switch(sessionAttributes.previousAction) {
            case "UnsubscribeIntent":
                if (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NoIntent') return giveNextPuzzle(handlerInput);
                else {
                    //TODO: THIS DOESN'T CURRENTLY DELETE THEIR PHONE NUMBER.
                    await updateUserRecord(handlerInput);
                    return CancelAndStopIntentHandler.handle(handlerInput);
                }
            break;
            case "HintIntent":
                if (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NoIntent') return giveNextPuzzle(handlerInput, "OK.  I've saved your hint for later. ");
                else {
                    //TODO: HAS THE USER ALREADY USED A HINT THIS GAME?
                    //TODO: DECREMENT THE HINT COUNT OF THE USER'S RECORD IN AIRTABLE.
                    var airtable = new Airtable({apiKey: process.env.airtable_api_key}).base(process.env.airtable_base_data);
                    var record = await new Promise((resolve, reject) => {
                        airtable('User').update([{
                            "id": sessionAttributes.user.RecordId,
                            "fields": {"HintCount": sessionAttributes.user.HintCount-1}
                        }], function(err, records) {
                                if (err) {console.error(err);return;}
                                resolve(records[0]);
                            });
                    });

                    return giveNextPuzzle(handlerInput, "Here's your hint<break time='.5s'/>" + sessionAttributes.game[0].fields.Hint);
                    
                    //TODO: GIVE THE USER THE HINT FOR THIS PUZZLE.
                }
            break;
            default:
                return ErrorHandler.handle(handlerInput);
            break;
        }
    }
};

const HintIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'HintIntent';
    },
    async handle(handlerInput) {
        console.log("<=== HINTINTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "HintIntent";
        var hintCount = sessionAttributes.user.HintCount;
        var speakOutput = "";
        //TODO: IF THEY ALREADY USED A HINT THIS GAME, DO NOT LET THEM USE ANOTHER HINT.
        if (hasSubscription(handlerInput)) {
            speakOutput = "You are a scavenger hunt subscriber. Thank you for your support! You can only use one hint per weekly game. Are you sure you want to use your hint now? ";
        }
        else if (hintCount > 0) {  //TODO: WE CAN ALSO CHECK TO SEE IF THEY HAVE THE SUBSCRIPTION.
            speakOutput = "You currently have " + hintCount  + " hints available. You can only use one per game. Are you sure you want to use a hint now? ";
        }
        else {
            const ms = handlerInput.serviceClientFactory.getMonetizationServiceClient();
            const locale = handlerInput.requestEnvelope.request.locale;
            
            return await ms.getInSkillProducts(locale).then(async function checkForProductAccess(result) {
                const subscription = result.inSkillProducts.find(record => record.referenceName === "Subscription");
                const hint = result.inSkillProducts.find(record => record.referenceName === "Hint");
            
                //TODO: IF THE USER IS NOT ABLE TO BUY THIS PRODUCT, PLEASE FIND ANOTHER OPTION.
                 
                    var upsellMessage = "You currently have zero hints available. Would you like to get one?";

                    return handlerInput.responseBuilder
                        .addDirective({
                            "type": "Connections.SendRequest",
                            "name": "Upsell",
                            "payload": {
                                "InSkillProduct": {
                                    "productId": hint.productId
                                },
                                "upsellMessage": upsellMessage
                            },
                            "token": "correlationToken"
                        })
                        .getResponse();
            });
        }

        //TODO: IF THE USER HAS A HINT AVAILABLE, ASK THEM IF THEY ARE THEY SURE THEY WANT TO USE IT.

        //TODO: IF THE USER DOESN'T HAVE A HINT, OFFER TO SELL THEM ONE.

        //TODO: SOMETIMES, REMIND THEM THAT A MONTHLY SUBSCRIPTION GETS THEM A WEEKLY HINT.

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

function isProduct(product) {
    return product && Object.keys(product).length > 0;
}

function isEntitled(product) {
    return isProduct(product) && product.entitled === "ENTITLED";
}

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    async handle(handlerInput) {
        console.log("<=== HELPINTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "AMAZON.HelpIntent";
        const speakOutput = "Help Message";

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    async handle(handlerInput) {
        console.log("<=== CANCEL AND STOP INTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = Alexa.getIntentName(handlerInput.requestEnvelope);
        const locale = handlerInput.requestEnvelope.request.locale;
        var speakOutput = await getRandomSpeech("Goodbye", locale);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};
/* *
 * FallbackIntent triggers when a customer says something that doesn’t map to any intents in your skill
 * It must also be defined in the language model (if the locale supports it)
 * This handler can be safely added but will be ingnored in locales that do not support it yet 
 * */
const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        console.log("<=== FALLBACKINTENT HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "AMAZON.FallbackIntent";
        const speakOutput = "Fallback Intent";

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};
/* *
 * SessionEndedRequest notifies that a session was ended. This handler will be triggered when a currently open 
 * session is closed for one of the following reasons: 1) The user says "exit" or "quit". 2) The user does not 
 * respond or says something that does not match an intent defined in your voice model. 3) An error occurs 
 * */
const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`~~~~ Session ended: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse(); // notice we send an empty response
    }
};
/* *
 * The intent reflector is used for interaction model testing and debugging.
 * It will simply repeat the intent the user said. You can create custom handlers for your intents 
 * by defining them above, then also adding them to the request handler chain below 
 * */
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = intentName;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};

const BuyIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest' &&
               handlerInput.requestEnvelope.request.intent.name === 'BuyIntent';
    },
    async handle(handlerInput) {
        console.log("<=== BuyIntent HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const locale = handlerInput.requestEnvelope.request.locale;
        const ms = handlerInput.serviceClientFactory.getMonetizationServiceClient();
 
        return ms.getInSkillProducts(locale).then(async function(res) {
            var requestedProduct = getResolvedWords(handlerInput, "product");
            console.log("REQUESTED PRODUCT RESOLUTION = " + JSON.stringify(requestedProduct));
            if (requestedProduct != undefined) {
                var product = res.inSkillProducts.find(record => record.referenceName.toLowerCase() == requestedProduct[0].value.name.toLowerCase());
                if (product != undefined) {
                    
                    return handlerInput.responseBuilder
                        .addDirective({
                            'type': 'Connections.SendRequest',
                            'name': 'Buy',
                            'payload': {
                                'InSkillProduct': {
                                    'productId': product.productId
                                }
                            },
                            'token': 'correlationToken'
                        })
                        .getResponse();
                }
            }
            else {
                var spokenWords = getSpokenWords(handlerInput, "product");
                var speakText = "I'm sorry. We don't have a product called " + spokenWords + ". Please try your purchase request again?";

                return handlerInput.responseBuilder
                    .speak(speakText)
                    .reprompt(speakText)
                    .getResponse();
            }
        });
    }
}; 

const SuccessfulPurchaseResponseHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === "Connections.Response"
            && (handlerInput.requestEnvelope.request.name === "Buy" || handlerInput.requestEnvelope.request.name === "Upsell")
            && (handlerInput.requestEnvelope.request.payload.purchaseResult == "ACCEPTED" || handlerInput.requestEnvelope.request.payload.purchaseResult == "ALREADY_PURCHASED");
    },
    async handle(handlerInput) {
        console.log("<=== SuccessfulPurchaseResponse HANDLER ===>");

        const locale = handlerInput.requestEnvelope.request.locale;
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const ms = handlerInput.serviceClientFactory.getMonetizationServiceClient();
        const productId = handlerInput.requestEnvelope.request.payload.productId;

        return ms.getInSkillProducts(locale).then(async function(res) {
            //TODO: WE NEED TO MODIFY THIS WHEN THE SUBSCRIPTION IS OFFERED.  CURRENTLY ONLY WORKS FOR HINT.
            //const hint = res.inSkillProducts.find(record => record.referenceName === "Hint");
            let product = res.inSkillProducts.find(record => record.productId == productId);
            //TODO: WHAT HAPPENS IF THE PRODUCT IS UNDEFINED?
            if (product != undefined) {
                if (product.referenceName === "Hint") {
                    var airtable = new Airtable({apiKey: process.env.airtable_api_key}).base(process.env.airtable_base_data);
                    var record = await new Promise((resolve, reject) => {
                        airtable('User').update([{
                            "id": sessionAttributes.user.RecordId,
                            "fields": {"HintCount": sessionAttributes.user.HintCount+1}
                        }], function(err, records) {
                                if (err) {console.error(err);return;}
                                resolve(records[0]);
                            });
                    });
                    console.log("HINTCOUNT = " + sessionAttributes.user.HintCount);
                    sessionAttributes.user.HintCount += 1;
                    console.log("HINTCOUNT = " + sessionAttributes.user.HintCount);
                    
                    return HintIntentHandler.handle(handlerInput);
                }
                else if (product.referenceName === "Subscription") {
                    return HintIntentHandler.handle(handlerInput);
                }
                
            }
            //TODO: DOES THERE NEED TO BE AN ELSE CASE HERE?  IS THIS POSSIBLE?
        });
    }
};

const ErrorPurchaseResponseHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === "Connections.Response"
            && (handlerInput.requestEnvelope.request.name === "Buy" || handlerInput.requestEnvelope.request.name === "Upsell")
            && handlerInput.requestEnvelope.request.payload.purchaseResult == 'ERROR';
    },
    async handle(handlerInput) {
        console.log("<=== ErrorPurchaseResponse HANDLER ===>");
        var speakText = "In the meantime, let's get you back to the puzzle. ";
        //"Sorry, I am unable to fulfill your request on this device.  Please try again from your Echo device."
        return giveNextPuzzle(handlerInput, speakText);
    }
};

const UnsuccessfulPurchaseResponseHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === "Connections.Response"
            && (handlerInput.requestEnvelope.request.name === "Buy" || handlerInput.requestEnvelope.request.name === "Upsell")
            && handlerInput.requestEnvelope.request.payload.purchaseResult == 'DECLINED';
    },
    async handle(handlerInput) {
        console.log("<=== UnsuccessfulPurchaseResponse HANDLER ===>");

        const locale = handlerInput.requestEnvelope.request.locale;
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        const ms = handlerInput.serviceClientFactory.getMonetizationServiceClient();
        const productId = handlerInput.requestEnvelope.request.payload.productId;

        return ms.getInSkillProducts(locale).then(async function(res) {
            let product = res.inSkillProducts.find(record => record.productId == productId);

            if (product != undefined) {
                var speakText = "Let's get you back to the puzzle. ";
                
                return giveNextPuzzle(handlerInput, speakText);
            }
            //TODO: DOES THERE NEED TO BE AN ELSE CASE HERE?  IS THIS POSSIBLE?
        });
    }
};



/**
 * Generic error handling to capture any syntax or routing errors. If you receive an error
 * stating the request handler chain is not found, you have not implemented a handler for
 * the intent being invoked or included it in the skill builder below 
 * */
const ErrorHandler = {
    canHandle() {
        return true;
    },
    async handle(handlerInput, error) {
        console.log("<=== ERROR HANDLER ===>");
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        sessionAttributes.previousAction = "ERROR HANDLER";
        const speakOutput = "<audio src='soundbank://soundlibrary/scifi/amzn_sfx_scifi_alarm_03'/>" + Alexa.getRequestType(handlerInput.requestEnvelope);
        console.log(`~~~~ Error handled: ${JSON.stringify(error.stack)}`);
        
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

async function getMobileNumber(handlerInput) {
    try {
        const upsServiceClient = handlerInput.serviceClientFactory.getUpsServiceClient();
        const mobileNumber = await upsServiceClient.getProfileMobileNumber();
        console.log("PHONE NUMBER = " + JSON.stringify(mobileNumber));
        return mobileNumber;
    }
    catch(error) {
        console.log(JSON.stringify(error));
        console.log(JSON.stringify(error.stack));

        if (error.statusCode === 403) {
            return undefined;
        }
    }
}

function fixPhoneNumber(phoneNumber, locale) {
    //TODO: FIX PHONE NUMBERS BASED ON THE LOCALE OF THE USER'S DEVICE.
    if (phoneNumber === undefined) return undefined;
    else if (phoneNumber.length < 10) return undefined;
    else if (phoneNumber.length === 10) return "+1" + phoneNumber;
    else return phoneNumber;
}

async function getEmailAddress(handlerInput) {
    try {
        const upsServiceClient = handlerInput.serviceClientFactory.getUpsServiceClient();
        const emailAddress = await upsServiceClient.getProfileEmail();
        console.log("EMAIL ADDRESS = " + JSON.stringify(emailAddress));
        return emailAddress;
    }
    catch(error) {
        console.log(JSON.stringify(error));
        console.log(JSON.stringify(error.stack));

        if (error.statusCode === 403) {
            return undefined;
        }
    }
}

function supportsAPL(handlerInput) {
    if (handlerInput.requestEnvelope.context.System &&
        handlerInput.requestEnvelope.context.System.device &&
        handlerInput.requestEnvelope.context.System.device.supportedInterfaces &&
        handlerInput.requestEnvelope.context.System.device.supportedInterfaces["Alexa.Presentation.APL"]) return true;
    return false;
}

function askForPermission(handlerInput, type) {
    return handlerInput.responseBuilder
    .speak("You haven't granted me permission to get your " + type + ".  I really need that to play this game.  I have written a card to your Alexa app to make it easy to give me that permission.")
    .withAskForPermissionsConsentCard(PERMISSIONS)
    .getResponse();
}

async function updateUserRecord(handlerInput, phoneNumber = undefined, pin = undefined, isValidated = false) {
    const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
    var fields = {};
    if (phoneNumber != undefined) fields.MobileNumber = phoneNumber;
    if (pin != undefined) fields.ValidationPin = pin;
    if (isValidated != undefined) fields.IsValidated = isValidated;
    console.log("FIELDS = " + JSON.stringify(fields));

    var airtable = new Airtable({apiKey: process.env.airtable_api_key}).base(process.env.airtable_base_data);
    var record = await new Promise((resolve, reject) => {
        airtable('User').update([{ 
            "id": sessionAttributes.user.RecordId,
            "fields": fields
        }], function(err, records) {
                if (err) {console.error(err);return;}
                console.log("UPDATED RECORD IN PROMISE = " + JSON.stringify(records[0]));
                resolve(records[0]);
            });
    });
    console.log("UPDATED RECORD = " + JSON.stringify(record));

    sessionAttributes.user = record.fields;
}

function sendTextMessage(phoneNumber, message) {
    console.log("SENDING TEXT MESSAGE. '" + phoneNumber + "', " + message + "'");
    const SNS = new AWS.SNS();
    var parameters = {PhoneNumber: phoneNumber, Message: "From Scavenger Hunt:\n" + message};
    var promise = SNS.publish(parameters).promise();
    promise.then(function(data) {return true;}
    ).catch(function(err){return false;});
    console.log("DONE SENDING TEXT MESSAGE. '" + message + "'");
    return promise;
}

async function getUserRecord(handlerInput) {
    console.log("GETTING USER RECORD");
    var userId = handlerInput.requestEnvelope.session.user.userId;
    //var mobileNumber = await getMobileNumber(handlerInput);
    //mobileNumber = mobileNumber.countryCode + "" + mobileNumber.phoneNumber;
    //console.log("MOBILE NUMBER STRING = " + JSON.stringify(mobileNumber));
    //var emailAddress = await getEmailAddress(handlerInput);


    var filter = "&filterByFormula=%7BUserId%7D%3D%22" + encodeURIComponent(userId) + "%22";
    const userRecord = await httpGet(process.env.airtable_base_data, filter, "User");
    //IF THERE ISN"T A USER RECORD, CREATE ONE.
    if (userRecord.records.length === 0){
        console.log("CREATING NEW USER RECORD");
        var airtable = new Airtable({apiKey: process.env.airtable_api_key}).base(process.env.airtable_base_data);
        return new Promise((resolve, reject) => {
            airtable("User").create({"UserId": userId}, 
                        function(err, record) {
                                console.log("NEW USER RECORD = " + JSON.stringify(record));
                                if (err) { console.error(err); return; }
                                resolve(record);
                            });
                        });
    }
    else{
        console.log("RETURNING FOUND USER RECORD = " + JSON.stringify(userRecord.records[0]));
        return userRecord.records[0];
        //if (mobileNumber === undefined) mobileNumber = "";
        //if (emailAddress === undefined) emailAddress = "";
        /*
        var airtable = new Airtable({apiKey: process.env.airtable_api_key}).base(process.env.airtable_base_data);
        return new Promise((resolve, reject) => {
            airtable('User').update([{ 
                "id": userRecord.records[0].fields.RecordId,
                "fields": {
                "MobileNumber": mobileNumber,
                "EmailAddress": emailAddress
                }
            }], function(err, records) {
                    if (err) {console.error(err);return;}
                    resolve(records[0]);
                });
        });
        */
    }
}

function getSpokenWords(handlerInput, slot) {
    if (handlerInput.requestEnvelope
        && handlerInput.requestEnvelope.request
        && handlerInput.requestEnvelope.request.intent
        && handlerInput.requestEnvelope.request.intent.slots
        && handlerInput.requestEnvelope.request.intent.slots[slot]
        && handlerInput.requestEnvelope.request.intent.slots[slot].value)
        return handlerInput.requestEnvelope.request.intent.slots[slot].value;
    else return undefined;
}

function getResolvedWords(handlerInput, slot) {
    if (handlerInput.requestEnvelope
        && handlerInput.requestEnvelope.request
        && handlerInput.requestEnvelope.request.intent
        && handlerInput.requestEnvelope.request.intent.slots
        && handlerInput.requestEnvelope.request.intent.slots[slot]
        && handlerInput.requestEnvelope.request.intent.slots[slot].resolutions
        && handlerInput.requestEnvelope.request.intent.slots[slot].resolutions.resolutionsPerAuthority) {
            for (var i = 0;i<handlerInput.requestEnvelope.request.intent.slots[slot].resolutions.resolutionsPerAuthority.length;i++) {
                if (handlerInput.requestEnvelope.request.intent.slots[slot].resolutions.resolutionsPerAuthority[i]
                    && handlerInput.requestEnvelope.request.intent.slots[slot].resolutions.resolutionsPerAuthority[i].values
                    && handlerInput.requestEnvelope.request.intent.slots[slot].resolutions.resolutionsPerAuthority[i].values[0])
                    return handlerInput.requestEnvelope.request.intent.slots[slot].resolutions.resolutionsPerAuthority[i].values;
            }
        }
        else return undefined;
}

async function getRandomSpeech(table, locale) {
    const response = await httpGet(process.env.airtable_base_speech, "&filterByFormula=AND(IsDisabled%3DFALSE(),FIND(%22" + locale + "%22%2C+Locale)!%3D0)", table);
    const speech = getRandomItem(response.records);
    console.log("RANDOM [" + table.toUpperCase() + "] = " + JSON.stringify(speech));
    return speech.fields.VoiceResponse;
}

async function hasSubscription(handlerInput) {
    const ms = handlerInput.serviceClientFactory.getMonetizationServiceClient();
    const locale = handlerInput.requestEnvelope.request.locale;
    return await ms.getInSkillProducts(locale).then(async function checkForProductAccess(result) {
        const subscription = result.inSkillProducts.find(record => record.referenceName === "Subscription");
        console.log("SUBSCRIPTION = " + JSON.stringify(subscription));
        return isEntitled(subscription);
    });
}

function getRandomItem(items) {
    var random = getRandom(0, items.length-1);
    return items[random];
}

function getRandom(min, max){
    return Math.floor(Math.random() * (max-min+1)+min);
}

function httpGet(base, filter, table = "Data"){
    var options = { host: "api.airtable.com", port: 443, path: "/v0/" + base + "/" + table + "?api_key=" + process.env.airtable_api_key + filter, method: "GET"};
    console.log("FULL PATH = http://" + options.host + options.path);
    return new Promise(((resolve, reject) => { const request = https.request(options, (response) => { response.setEncoding("utf8");let returnData = "";
        if (response.statusCode < 200 || response.statusCode >= 300) { return reject(new Error(`${response.statusCode}: ${response.req.getHeader("host")} ${response.req.path}`));}
        response.on("data", (chunk) => { returnData += chunk; });
        response.on("end", () => { resolve(JSON.parse(returnData)); });
        response.on("error", (error) => { reject(error);});});
        request.end();
    }));
}

const RequestLog = {
    async process(handlerInput) {
        console.log("REQUEST ENVELOPE = " + JSON.stringify(handlerInput.requestEnvelope));
        const sessionAttributes = handlerInput.attributesManager.getSessionAttributes();
        var userRecord = await getUserRecord(handlerInput);
        sessionAttributes.user = userRecord.fields;
        console.log("USER RECORD = " + JSON.stringify(userRecord.fields));
        const response = await httpGet(process.env.airtable_base_data, "&filterByFormula=AND(IsDisabled%3DFALSE(),IsActive%3D1,FIND(%22" + sessionAttributes.user.RecordId + "%22%2C+UserCompleted)%3D0)&sort%5B0%5D%5Bfield%5D=GameDate&sort%5B0%5D%5Bdirection%5D=desc&sort%5B1%5D%5Bfield%5D=Order&sort%5B1%5D%5Bdirection%5D=asc", "Puzzle");
        //&fields%5B%5D=Order&fields%5B%5D=Game&fields%5B%5D=GameDate&fields%5B%5D=Title&fields%5B%5D=VoiceResponse&fields%5B%5D=Synonyms&fields%5B%5D=CardResponse&fields%5B%5D=ScreenResponse&fields%5B%5D=TextResponse&fields%5B%5D=Hint&fields%5B%5D=Media&fields%5B%5D=Answer
        sessionAttributes.game = response.records;
        console.log("GAME DETAILS = " + JSON.stringify(response.records));
        
    }
};
  
const ResponseLog = {
    process(handlerInput) {
        console.log("RESPONSE BUILDER = " + JSON.stringify(handlerInput.responseBuilder.getResponse()));   
    }
};
/**
 * This handler acts as the entry point for your skill, routing all request and response
 * payloads to the handlers above. Make sure any new handlers or interceptors you've
 * defined are included below. The order matters - they're processed top to bottom 
 * */
exports.handler = Alexa.SkillBuilders.custom()
    .addRequestHandlers(
        LaunchRequestHandler,
        PhoneNumberIntentHandler,
        PinValidationIntentHandler,
        AnswerIntentHandler,
        ChangePhoneNumberIntentHandler,
        HelpIntentHandler,
        UnsubscribeIntentHandler,
        YesNoIntentHandler,
        HintIntentHandler,
        CancelAndStopIntentHandler,
        BuyIntentHandler,
        UnsuccessfulPurchaseResponseHandler,
        SuccessfulPurchaseResponseHandler,
        ErrorPurchaseResponseHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler)
    .addErrorHandlers(
        ErrorHandler)
    .addRequestInterceptors(RequestLog)
    .addResponseInterceptors(ResponseLog)
    .withApiClient(new Alexa.DefaultApiClient())
    .lambda();
