'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class DisasterAlert extends Model {
    static associate(models) {
      // define associations here
    }
  }

  DisasterAlert.init({
    message: {
      type: DataTypes.TEXT,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    coordinates: {
      type: DataTypes.GEOMETRY('POINT', 4326),
      allowNull: false,
    },
    radius_m: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 500,
      validate: {
        min: 0,
      },
    },
    weight_penalty: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 30,
      validate: {
        min: 0,
        max: 100,
      },
    },
    received_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW,
    },
    expires_at: {
      type: DataTypes.DATE,
      allowNull: false,
    },
  }, {
    sequelize,
    modelName: 'DisasterAlert',
    indexes: [
      {
        unique: true,
        fields: ['message'],
      },
    ],
  });

  return DisasterAlert;
};
