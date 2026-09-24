// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Cerberus {
    uint256 public constant MAX_TITLE_BYTES = 140;
    uint256 public constant MAX_DESCRIPTION_BYTES = 800;

    struct PitchRecord {
        address proposer;
        string title;
        string description;
        uint8 scoreScrath;
        uint8 scoreFervent;
        uint8 scoreWarden;
        uint8 overall;
        uint64 recordedAt;
    }

    error EmptyTitle();
    error TitleTooLong();
    error EmptyDescription();
    error DescriptionTooLong();
    error ScoreOutOfRange();
    error RecordDoesNotExist();

    uint256 private _recordCount;
    mapping(uint256 => PitchRecord) private _records;

    event ProposalRecorded(uint256 indexed proposalId, address indexed proposer, uint8 overall);

    function recordRecord(
        string calldata title,
        string calldata description,
        uint8 scoreScrath,
        uint8 scoreFervent,
        uint8 scoreWarden,
        uint8 overall
    ) external returns (uint256 proposalId) {
        uint256 titleLength = bytes(title).length;
        if (titleLength == 0) {
            revert EmptyTitle();
        }
        if (titleLength > MAX_TITLE_BYTES) {
            revert TitleTooLong();
        }

        uint256 descriptionLength = bytes(description).length;
        if (descriptionLength == 0) {
            revert EmptyDescription();
        }
        if (descriptionLength > MAX_DESCRIPTION_BYTES) {
            revert DescriptionTooLong();
        }

        if (scoreScrath > 100 || scoreFervent > 100 || scoreWarden > 100 || overall > 100) {
            revert ScoreOutOfRange();
        }

        proposalId = _recordCount;
        PitchRecord storage record = _records[proposalId];
        record.proposer = msg.sender;
        record.title = title;
        record.description = description;
        record.scoreScrath = scoreScrath;
        record.scoreFervent = scoreFervent;
        record.scoreWarden = scoreWarden;
        record.overall = overall;
        record.recordedAt = uint64(block.timestamp);

        _recordCount++;
        emit ProposalRecorded(proposalId, msg.sender, overall);
    }

    function getRecord(
        uint256 proposalId
    )
        external
        view
        returns (
            address proposer,
            string memory title,
            string memory description,
            uint8 scoreScrath,
            uint8 scoreFervent,
            uint8 scoreWarden,
            uint8 overall,
            uint64 recordedAt
        )
    {
        PitchRecord storage record = _getRecord(proposalId);
        return (
            record.proposer,
            record.title,
            record.description,
            record.scoreScrath,
            record.scoreFervent,
            record.scoreWarden,
            record.overall,
            record.recordedAt
        );
    }

    function recordCount() external view returns (uint256) {
        return _recordCount;
    }

    function _getRecord(uint256 proposalId) private view returns (PitchRecord storage) {
        if (proposalId >= _recordCount) {
            revert RecordDoesNotExist();
        }
        return _records[proposalId];
    }
}