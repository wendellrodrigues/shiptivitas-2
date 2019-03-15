import express from 'express';
import Database from 'better-sqlite3';
import { stat } from 'fs';
import { start } from 'repl';


const app = express();

app.use(express.json());

app.get('/', (req, res) => {
  return res.status(200).send({'message': 'SHIPTIVITY API. Read documentation to see API docs'});
});

// We are keeping one connection alive for the rest of the life application for simplicity
const db = new Database('./clients.db');

// Don't forget to close connection when server gets terminated
const closeDb = () => db.close();
process.on('SIGTERM', closeDb);
process.on('SIGINT', closeDb);

/**
 * Validate id input
 * @param {any} id
 */
const validateId = (id) => {
  if (Number.isNaN(id)) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid id provided.',
      'long_message': 'Id can only be integer.',
      },
    };
  }
  const client = db.prepare('select * from clients where id = ? limit 1').get(id);
  if (!client) {
    return {
      valid: false,
      messageObj: {
      'message': 'Invalid id provided.',
      'long_message': 'Cannot find client with that id.',
      },
    };
  }
  return {
    valid: true,
  };
}

/**
 * Validate priority input
 * FIXED THIS >>> Does not need 
 * @param {any} priority
 */
const validatePriority = (priority) => {
  if(Number.isNaN(priority)) {
    return {
      validPriority: false,
      message: {
      'message': 'Invalid priority provided.',
      'long_message': 'Priority can only be positive integer.',
      },
    };
  }
  return {
    validPriority: true,
  }
}

/**
 * Get all of the clients. Optional filter 'status'
 * GET /api/v1/clients?status={status} - list all clients, optional parameter status: 'backlog' | 'in-progress' | 'complete'
 */
app.get('/api/v1/clients', (req, res) => {
  const status = req.query.status;
  if (status) {
    // status can only be either 'backlog' | 'in-progress' | 'complete'
    if (status !== 'backlog' && status !== 'in-progress' && status !== 'complete') {
      return res.status(400).send({
        'message': 'Invalid status provided.',
        'long_message': 'Status can only be one of the following: [backlog | in-progress | complete].',
      });
    }
    const clients = db.prepare('select * from clients where status = ?').all(status);
    return res.status(200).send(clients);
  }
  const statement = db.prepare('select * from clients');
  const clients = statement.all();
  return res.status(200).send(clients);
});

/**
 * Get a client based on the id provided.
 * GET /api/v1/clients/{client_id} - get client by id
 */
app.get('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }
  return res.status(200).send(db.prepare('select * from clients where id = ?').get(id));
});

/**
 * When an element is placed near the beginning of a list of priorities ,
 * The other elements need to move down
 * This func takes elements after where an element is moved to
 * And changes their priorities (makes them +1 one at a time)
 * @param {int} start     The beginning of the moving section of the array 
 * @param {int} end       The end of the moving section of the array
 * @param {array} array   The array that needs moving
 * @param {int} priority  The priority that will be incremented in order to move other elements downward
 */
const moveElementsDown = (start, end, array, priority) => {
  for(let i=start; i<end; i++) {
    const id = array[i];
    priority++;
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(priority, id);
  }
}

/**
 * When an element is placed near the end of a list of priorities,
 * The other elements need to move up
 * This func takes elements after where an element is moved to
 * And changes their priorities (makes them -1 one at a time)
 * @param {int} start     The beginning of the moving section of the array 
 * @param {int} end       The end of the moving section of the array
 * @param {array} array   The array that needs moving
 * @param {int} priority  The priority that will be decremented in order to move other elements upward
 */
const moveElementsUp = (start, end, array, priority) => {
  for(let i=end; i>start; i--) {
    const id = array[i];
    priority--;
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(priority, id);
  }
}

/**
 * Update client information based on the parameters provided.
 * When status is provided, the client status will be changed
 * When priority is provided, the client priority will be changed with the rest of the clients accordingly
 * Note that priority = 1 means it has the highest priority (should be on top of the swimlane).
 * No client on the same status should not have the same priority.
 * This API should return list of clients on success
 *
 * PUT /api/v1/clients/{client_id} - change the status of a client
 *    Data:
 *      status (optional): 'backlog' | 'in-progress' | 'complete',
 *      priority (optional): integer,
 *
 */
app.put('/api/v1/clients/:id', (req, res) => {
  const id = parseInt(req.params.id , 10);
  const { valid, messageObj } = validateId(id);
  if (!valid) {
    res.status(400).send(messageObj);
  }

  let { status, priority } = req.body;
  let clients = db.prepare('select * from clients').all();
  const client = clients.find(client => client.id === id);

  console.log('priority in main', priority);


  /* ---------- Update code below ----------*/

  //Make an array of this swimlane, and extract the client ids 
  let thisClientStatus = null;
  for(let client of clients) {
    if(client.id === id) {
      thisClientStatus = client.status;
    }
  };

  //If status isnt given, 
  const thisSwimLane = [];
  for(let client of clients) {
    if(client.status === thisClientStatus) {
      thisSwimLane.push(client);
    }
  };

  //Create helper func for sorting the swimlane from least priority -> greatest priority
  function compare(a, b)  {
    if (a.priority < b.priority) return -1;
    if (a.priority > b.priority) return 1;
    return 0;
  };

  const sortedByPriorityThis = thisSwimLane.sort(compare);

  //Get Id from sorted swimlane array
  const sortedIdsThisSwimlane = []
  for(let client of sortedByPriorityThis) {
    sortedIdsThisSwimlane.push(client.id);
  }

  //Get swimlane of target (to be moved to)
  const targetSwimLane = [];
  for(let client of clients) {
    if(client.status === status) {
      targetSwimLane.push(client);
    }
  };

  const sortedByPriorityTarget = targetSwimLane.sort(compare);

  const sortedIdsTargetSwimlane = []
  for(let client of sortedByPriorityTarget) {
    sortedIdsTargetSwimlane.push(client.id);
  }

   //Same Swimlane
  if(status === client.status) {
    //If priority inputted from body is greater than swimlength's greatest value priority, set to max number
    //THIS MAY BREAK STUF 
    if(priority > thisSwimLane.length){
      priority = thisSwimLane.length;
    }
    //If moving element higher up in the array
    if(client.priority > priority) {
      const startPriority = priority - 1;
      const endPriority = client.priority - 1;
      //Move other elements downward
      moveElementsDown(startPriority, endPriority, sortedIdsThisSwimlane, priority);
      //Set priority of the element to be moved
      db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(priority, id);
    }
    //If moving element lower down in the array
    else if(client.priority < priority) {
      const startPriority = client.priority - 1;
      const endPriority = priority - 1;
       //Move other elements upward
       moveElementsUp(startPriority, endPriority, sortedIdsThisSwimlane, priority);
      //Set priority of the element to be moved
      db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(priority, id);
    }
  } 

  //Different Swimlane
  else {
    //If priority inputted from body is greater than swimlength's greatest value priority, set to max number
    if(priority > targetSwimLane.length){
      priority = targetSwimLane.length + 1;
    }

    //Get start and end priority
    const startThisPriority = client.priority - 1;
    const endThisPriority = thisSwimLane.length - 1;

    //Move priority positions UP in current swimlane
    const priorityAtEnd = thisSwimLane[thisSwimLane.length-1].priority;
    moveElementsUp(startThisPriority, endThisPriority, sortedIdsThisSwimlane, priorityAtEnd);

    //Move priority positions DOWN in target swimlane
    const startTargetPriority = priority - 1;
    const endTargetPriority = targetSwimLane.length;
    moveElementsDown(startTargetPriority, endTargetPriority, sortedIdsTargetSwimlane, priority);

    //(change status and priority to whats specified in body of request)
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(priority, id);
    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run(status, id);
  }

  return res.status(200).send(clients); 
});

/**
 * Helper function that sets everything back to normal, for testing
 */
const setNormal = () => {
  
    //Everything in in-progress back to normal
    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('in-progress',  1);    //Sets Stark 
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(1,  1);              //Sets Stark 

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('complete',  2);       //Sets Wiza
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(1,  2);              //Sets Wiza

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('backlog',  3);        //Sets Nolan
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(1,  3);              //Sets Nolan

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('in-progress',  4);    //Sets Thompson
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(2,  4);              //Sets Thompson

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('in-progress',  5);    //Sets Walker Williamson
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(3,  5);              //Sets Walker Williamson

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('backlog',  6);        //Sets Boehm
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(2,  6);              //Sets Boehm

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('backlog',  7);        //Sets Runolfson
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(3,  7);              //Sets Runolfson

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('backlog',  8);        //Sets Shumm
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(4,  8);              //Sets Shumm

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('backlog',  9);        //Sets Kohler
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(5,  9);              //Sets Kohler

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('backlog',  10);        //Sets Romaguera
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(6,  10);              //Sets Romaguera

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('complete',  11);       //Sets Rielley
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(2,  11);              //Sets Rielley

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('backlog',  12);        //Sets Emard
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(7,  12);              //Sets Emard

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('complete',  13);       //Sets Fritzsh
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(3,  13);              //Sets Fritzsh

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('backlog',  14);        //Sets Borer
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(8,  14);              //Sets Borer

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('in-progress',  15);    //Sets Emerich
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(4,  15);              //Sets Emerich

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('in-progress',  16);    //Sets Wilms
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(5,  16);              //Sets Wilms

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('complete',  17);       //Sets Brekke
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(4,  17);              //Sets Brekke

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('backlog',  18);        //Sets Bins
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(9,  18);              //Sets Bins

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('backlog',  19);        //Sets Hodkiewicz
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(10,  19);             //Sets Hodkiewicz

    db.prepare("UPDATE clients SET STATUS = ? WHERE id = ?").run('backlog',  20);        //Sets Murphy
    db.prepare("UPDATE clients SET PRIORITY = ? WHERE id = ?").run(11,  20);             //Sets Murphy
}

app.listen(3001);

console.log('app running on port ', 3001);
