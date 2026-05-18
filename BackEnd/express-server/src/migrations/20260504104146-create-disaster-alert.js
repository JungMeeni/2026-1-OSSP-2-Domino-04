'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('DisasterAlerts', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      message: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      coordinates: {
        type: Sequelize.GEOMETRY('POINT', 4326),
        allowNull: false
      },
      radius_m: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      weight_penalty: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 0
      },
      received_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      expires_at: {
        type: Sequelize.DATE,
        allowNull: false
      },
      created_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP')
      },
      updated_at: {
        allowNull: false,
        type: Sequelize.DATE,
        defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP')
      }
    });
    await queryInterface.addIndex('DisasterAlerts', ['coordinates'], {
      type: 'SPATIAL',
      name: 'disaster_alerts_coordinates_spatial'
    });
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('DisasterAlerts');
  }
};