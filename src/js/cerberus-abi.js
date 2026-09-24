(function () {
  "use strict";

  window.CERBERUS_ABI = [
    {
      "inputs": [],
      "name": "DescriptionTooLong",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "EmptyDescription",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "EmptyTitle",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "RecordDoesNotExist",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "ScoreOutOfRange",
      "type": "error"
    },
    {
      "inputs": [],
      "name": "TitleTooLong",
      "type": "error"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "internalType": "uint256",
          "name": "proposalId",
          "type": "uint256"
        },
        {
          "indexed": true,
          "internalType": "address",
          "name": "proposer",
          "type": "address"
        },
        {
          "indexed": false,
          "internalType": "uint8",
          "name": "overall",
          "type": "uint8"
        }
      ],
      "name": "ProposalRecorded",
      "type": "event"
    },
    {
      "inputs": [],
      "name": "MAX_DESCRIPTION_BYTES",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "MAX_TITLE_BYTES",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [],
      "name": "recordCount",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "",
          "type": "uint256"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "string",
          "name": "title",
          "type": "string"
        },
        {
          "internalType": "string",
          "name": "description",
          "type": "string"
        },
        {
          "internalType": "uint8",
          "name": "scoreScrath",
          "type": "uint8"
        },
        {
          "internalType": "uint8",
          "name": "scoreFervent",
          "type": "uint8"
        },
        {
          "internalType": "uint8",
          "name": "scoreWarden",
          "type": "uint8"
        },
        {
          "internalType": "uint8",
          "name": "overall",
          "type": "uint8"
        }
      ],
      "name": "recordRecord",
      "outputs": [
        {
          "internalType": "uint256",
          "name": "proposalId",
          "type": "uint256"
        }
      ],
      "stateMutability": "nonpayable",
      "type": "function"
    },
    {
      "inputs": [
        {
          "internalType": "uint256",
          "name": "proposalId",
          "type": "uint256"
        }
      ],
      "name": "getRecord",
      "outputs": [
        {
          "internalType": "address",
          "name": "proposer",
          "type": "address"
        },
        {
          "internalType": "string",
          "name": "title",
          "type": "string"
        },
        {
          "internalType": "string",
          "name": "description",
          "type": "string"
        },
        {
          "internalType": "uint8",
          "name": "scoreScrath",
          "type": "uint8"
        },
        {
          "internalType": "uint8",
          "name": "scoreFervent",
          "type": "uint8"
        },
        {
          "internalType": "uint8",
          "name": "scoreWarden",
          "type": "uint8"
        },
        {
          "internalType": "uint8",
          "name": "overall",
          "type": "uint8"
        },
        {
          "internalType": "uint64",
          "name": "recordedAt",
          "type": "uint64"
        }
      ],
      "stateMutability": "view",
      "type": "function"
    }
  ];
})();